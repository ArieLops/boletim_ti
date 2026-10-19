// Exportador PDF/PNG via Chromium headless (puppeteer-core). Um navegador compartilhado, um trabalho por vez.
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { pickScale } = require('./fit');

const PX_POR_MM = 96 / 25.4;
const A4_PX = { largura: 794, altura: 1123 }; // A4 a 96 dpi
const A4_LARGURA_CSS = 210 * PX_POR_MM; // 793,7007874 px
const EMAIL_PX = { largura: 1240, altura: 1754 }; // A4 a 150 dpi
const WHATSAPP_PX = { largura: 1080, altura: 1527 }; // folha A4 (210x297) em 1080 de largura
const TIMEOUT_PADRAO_MS = 30000;
const LIMITE_CURTO_MS = 5000; // newPage / page.close

const CAMINHOS = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
};

class ExportUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExportUnavailableError';
  }
}

function ehArquivo(caminho) {
  try {
    return fs.statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function resolverNavegador() {
  const definido = (process.env.CHROMIUM_PATH || '').trim();
  if (definido) {
    if (!ehArquivo(definido)) {
      throw new ExportUnavailableError(`Navegador para exportação não encontrado em CHROMIUM_PATH (${definido}). Ajuste CHROMIUM_PATH para o arquivo executável do Chromium/Chrome/Edge.`);
    }
    return definido;
  }
  const achado = (CAMINHOS[process.platform] || []).find(ehArquivo);
  if (!achado) {
    throw new ExportUnavailableError('Nenhum Chromium/Chrome/Edge encontrado para exportar PDF/PNG. Instale um deles ou defina CHROMIUM_PATH com o caminho do executável.');
  }
  return achado;
}

function ihdrPng(buf) {
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

// Rejeita se a promessa nao resolver em ms (limpa o timer).
function limitar(promessa, ms, mensagem) {
  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(mensagem)), ms); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

function matar(browser) {
  try { browser.process()?.kill('SIGKILL'); } catch { /* ja encerrado */ }
  return browser.close().catch(() => {});
}

// Argumentos de lancamento do Chromium. --no-sandbox so quando necessario: root no Linux (o sandbox
// recusa rodar) ou CHROMIUM_NO_SANDBOX=1 (ultimo recurso: Ubuntu 24.04 com AppArmor restringindo
// user namespaces, Chromium via snap, containers).
function chromiumArgs({ platform = process.platform, uid = process.getuid ? process.getuid() : undefined, env = process.env } = {}) {
  const args = ['--disable-gpu', '--font-render-hinting=none'];
  if ((platform === 'linux' && uid === 0) || env.CHROMIUM_NO_SANDBOX === '1') args.push('--no-sandbox');
  return args;
}

function createExporter({ renderHtml, piso = 0.75, hooks = {}, timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
  if (typeof renderHtml !== 'function') throw new TypeError('createExporter: renderHtml é obrigatório');
  const limiteCurto = Math.min(LIMITE_CURTO_MS, timeoutMs);
  let browserPromise = null;
  let fechado = false;
  let cadeia = Promise.resolve();

  function obterBrowser() {
    if (!browserPromise) {
      const p = (async () => {
        const executablePath = resolverNavegador();
        const args = chromiumArgs();
        let browser;
        try {
          browser = await puppeteer.launch({ executablePath, headless: true, args, timeout: timeoutMs });
        } catch (err) {
          throw new ExportUnavailableError(`Não foi possível abrir o navegador para exportação (${executablePath}): ${err.message}. Verifique CHROMIUM_PATH.`, { cause: err });
        }
        browser.on('disconnected', () => {
          if (browserPromise === p) browserPromise = null;
        });
        return browser;
      })();
      browserPromise = p;
      p.catch(() => { if (browserPromise === p) browserPromise = null; }); // falha de launch nao envenena o cache
    }
    return browserPromise;
  }

  // Descarta o navegador atual (travado/quebrado): o proximo trabalho relanca.
  function derrubarNavegador() {
    const p = browserPromise;
    browserPromise = null;
    if (p) p.then(matar, () => {});
  }

  async function executar(fn) {
    if (fechado) throw new Error('Exportador encerrado.');
    let timer;
    let estourou = false;
    const limite = new Promise((_, rej) => {
      timer = setTimeout(() => {
        estourou = true;
        rej(new Error(`Tempo limite de ${timeoutMs / 1000}s excedido na exportação.`));
      }, timeoutMs);
    });
    limite.catch(() => {});
    let page = null;
    try {
      const browser = await Promise.race([obterBrowser(), limite]);
      page = await Promise.race([limitar(browser.newPage(), limiteCurto, 'O navegador não abriu uma página a tempo.'), limite]);
      const trabalho = fn(page);
      trabalho.catch(() => {}); // evita rejeicao nao tratada se o limite vencer
      return await Promise.race([trabalho, limite]);
    } catch (err) {
      if (estourou || /não abriu uma página/.test(err.message)) derrubarNavegador();
      throw err;
    } finally {
      clearTimeout(timer);
      if (page) await limitar(page.close(), limiteCurto, 'fechar página').catch(derrubarNavegador);
    }
  }

  // Fila serial: um trabalho por vez; falha de um nao quebra os seguintes.
  function enfileirar(fn) {
    const p = cadeia.then(async () => {
      if (hooks.onJobStart) hooks.onJobStart();
      try {
        return await executar(fn);
      } finally {
        if (hooks.onJobEnd) hooks.onJobEnd();
      }
    });
    cadeia = p.catch(() => {});
    return p;
  }

  async function carregar(page, html) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
  }

  // Carrega o HTML A4 UMA vez; as escalas sao aplicadas via variavel CSS --escala (tudo no renderer usa calc(... * var(--escala))).
  async function abrirA4(page, input) {
    await page.setViewport({ width: A4_PX.largura, height: A4_PX.altura, deviceScaleFactor: 1 });
    await carregar(page, renderHtml({ ...input, mode: 'a4', scale: 1 }));
  }

  async function aplicarEscala(page, scale) {
    await page.evaluate(async (sc) => {
      document.documentElement.style.setProperty('--escala', String(sc));
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => r()));
    }, scale);
  }

  async function medirMm(page, scale) {
    await aplicarEscala(page, scale);
    const { sh, h } = await page.$eval('#conteudo', (el) => ({ sh: el.scrollHeight, h: el.getBoundingClientRect().height }));
    // scrollHeight e inteiro (arredonda 1122,5 para 1123): se nao passa da altura real arredondada, o conteudo cabe e vale a altura real
    const px = sh <= Math.ceil(h) ? h : sh;
    return px / PX_POR_MM;
  }

  // `opts.piso` (por chamada) sobrepõe o piso padrão do exportador; valor inválido é ignorado.
  const pisoDe = (opts) => (opts && Number.isFinite(opts.piso) && opts.piso > 0 && opts.piso <= 1 ? opts.piso : piso);

  const ajustar = (page, pisoUsado = piso) => pickScale((sc) => medirMm(page, sc), { piso: pisoUsado });

  // Pagina A4 carregada e ja na escala escolhida.
  async function paginaA4(page, input, pisoUsado) {
    await abrirA4(page, input);
    const fit = await ajustar(page, pisoUsado);
    await aplicarEscala(page, fit.scale);
    return fit;
  }

  // PNG da folha A4 inteira em `dim` (largura x altura): viewport exato com dsf 1 e o conteudo ampliado por CSS zoom
  // (largura / 210mm em px). Serve ao PNG de e-mail (1240x1754) e ao do WhatsApp (1080x1527).
  async function pngA4(page, input, opts, dim, rotulo) {
    await paginaA4(page, input, pisoDe(opts));
    await page.setViewport({ width: dim.largura, height: dim.altura, deviceScaleFactor: 1 });
    const medidas = await page.evaluate(async (fator) => {
      document.documentElement.style.zoom = String(fator);
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => r()));
      const pag = document.querySelector('.pagina').getBoundingClientRect();
      const rod = document.querySelector('.rodape').getBoundingClientRect();
      return {
        larguraPagina: pag.width,
        rodapeTopo: rod.top,
        scrollX: document.documentElement.scrollWidth,
        largJanela: window.innerWidth,
        altJanela: window.innerHeight,
      };
    }, dim.largura / A4_LARGURA_CSS);
    if (Math.abs(medidas.larguraPagina - dim.largura) > 1 || medidas.scrollX > medidas.largJanela || medidas.rodapeTopo < medidas.altJanela * 0.8) {
      throw new Error(`Layout do PNG de ${rotulo} fora do esperado: ${JSON.stringify(medidas)}`);
    }
    const buf = Buffer.from(await page.screenshot({ type: 'png' }));
    const { largura, altura } = ihdrPng(buf);
    if (largura !== dim.largura || altura !== dim.altura) {
      throw new Error(`PNG de ${rotulo} com tamanho inesperado: ${largura}x${altura}`);
    }
    return buf;
  }

  return {
    fit: (input, opts) => enfileirar(async (page) => {
      await abrirA4(page, input);
      return ajustar(page, pisoDe(opts));
    }),

    pdf: (input, opts) => enfileirar(async (page) => {
      await paginaA4(page, input, pisoDe(opts));
      return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: false, width: '210mm', height: '297mm', margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
    }),

    pngEmail: (input, opts) => enfileirar((page) => pngA4(page, input, opts, EMAIL_PX, 'e-mail')),

    pngWhatsapp: (input, opts) => enfileirar((page) => pngA4(page, input, opts, WHATSAPP_PX, 'WhatsApp')),

    // Apoio a testes: navegador atual (ou null) e numero de paginas abertas nele.
    _browser: () => browserPromise,
    async _paginasAbertas() {
      const p = browserPromise;
      if (!p) return 0;
      return (await (await p).pages()).length;
    },

    async close() {
      fechado = true;
      await cadeia.catch(() => {});
      const p = browserPromise;
      browserPromise = null;
      if (p) {
        const browser = await p.catch(() => null);
        if (browser) await browser.close().catch(() => {});
      }
    },
  };
}

module.exports = { createExporter, ExportUnavailableError, chromiumArgs };
