// Exportador PDF/PNG via Chromium headless (puppeteer-core). Um navegador compartilhado, um trabalho por vez.
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const { pickScale } = require('./fit');

const PX_POR_MM = 96 / 25.4;
const A4_PX = { largura: 794, altura: 1123 }; // A4 a 96 dpi
const EMAIL_PX = { largura: 1240, altura: 1754 }; // A4 a 150 dpi
const WHATSAPP_LARGURA = 1080;
const WHATSAPP_ALTURA_MAX = 4000;
const TIMEOUT_MS = 30000;

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

function resolverNavegador() {
  const definido = process.env.CHROMIUM_PATH;
  if (definido) {
    if (!fs.existsSync(definido)) {
      throw new ExportUnavailableError(`Navegador para exportação não encontrado em CHROMIUM_PATH (${definido}). Ajuste CHROMIUM_PATH para o executável do Chromium/Chrome/Edge.`);
    }
    return definido;
  }
  const achado = (CAMINHOS[process.platform] || []).find((c) => fs.existsSync(c));
  if (!achado) {
    throw new ExportUnavailableError('Nenhum Chromium/Chrome/Edge encontrado para exportar PDF/PNG. Instale um deles ou defina CHROMIUM_PATH com o caminho do executável.');
  }
  return achado;
}

function ihdrPng(buf) {
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

function createExporter({ renderHtml, piso = 0.75, hooks = {} } = {}) {
  if (typeof renderHtml !== 'function') throw new TypeError('createExporter: renderHtml é obrigatório');
  let browserPromise = null;
  let fechado = false;
  let cadeia = Promise.resolve();

  function obterBrowser() {
    if (!browserPromise) {
      const p = (async () => {
        const executablePath = resolverNavegador();
        const args = ['--disable-gpu', '--font-render-hinting=none'];
        if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
        let browser;
        try {
          browser = await puppeteer.launch({ executablePath, headless: true, args });
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

  async function executar(fn) {
    if (fechado) throw new Error('Exportador encerrado.');
    const browser = await obterBrowser();
    const page = await browser.newPage();
    let timer;
    try {
      const limite = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`Tempo limite de ${TIMEOUT_MS / 1000}s excedido na exportação.`)), TIMEOUT_MS);
      });
      const trabalho = fn(page);
      trabalho.catch(() => {}); // evita rejeicao nao tratada se o limite vencer
      return await Promise.race([trabalho, limite]);
    } finally {
      clearTimeout(timer);
      await page.close().catch(() => {});
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

  async function medirMm(page, input, scale) {
    await page.setViewport({ width: A4_PX.largura, height: A4_PX.altura, deviceScaleFactor: 1 });
    await carregar(page, renderHtml({ ...input, mode: 'a4', scale }));
    const { sh, h } = await page.$eval('#conteudo', (el) => ({ sh: el.scrollHeight, h: el.getBoundingClientRect().height }));
    // scrollHeight e inteiro (arredonda 1122,5 para 1123): se nao passa da altura real arredondada, o conteudo cabe e vale a altura real
    const px = sh <= Math.ceil(h) ? h : sh;
    return px / PX_POR_MM;
  }

  const ajustar = (page, input) => pickScale((sc) => medirMm(page, input, sc), { piso });

  async function paginaA4(page, input) {
    const fit = await ajustar(page, input);
    await carregar(page, renderHtml({ ...input, mode: 'a4', scale: fit.scale }));
    return fit;
  }

  async function medirWhatsapp(page, input) {
    await page.setViewport({ width: WHATSAPP_LARGURA, height: 800, deviceScaleFactor: 1 });
    await carregar(page, renderHtml({ ...input, mode: 'strip', scale: 1 }));
    const altura = await page.evaluate(() => Math.ceil(document.querySelector('.pagina').getBoundingClientRect().height));
    return { largura: WHATSAPP_LARGURA, altura, muitoAlta: altura > WHATSAPP_ALTURA_MAX };
  }

  return {
    fit: (input) => enfileirar((page) => ajustar(page, input)),

    pdf: (input) => enfileirar(async (page) => {
      await paginaA4(page, input);
      return Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: false, width: '210mm', height: '297mm', margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
    }),

    pngEmail: (input) => enfileirar(async (page) => {
      await paginaA4(page, input);
      const larguraCss = 210 * PX_POR_MM; // 793,7 px
      const alturaCss = 297 * PX_POR_MM; // 1122,5 px
      const fator = EMAIL_PX.largura / larguraCss;
      await page.setViewport({ width: A4_PX.largura, height: A4_PX.altura, deviceScaleFactor: fator });
      const buf = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: larguraCss, height: alturaCss } }));
      const { largura, altura } = ihdrPng(buf);
      if (largura !== EMAIL_PX.largura || altura !== EMAIL_PX.altura) {
        throw new Error(`PNG de e-mail com tamanho inesperado: ${largura}x${altura}`);
      }
      return buf;
    }),

    whatsappInfo: (input) => enfileirar((page) => medirWhatsapp(page, input)),

    pngWhatsapp: (input) => enfileirar(async (page) => {
      const { altura } = await medirWhatsapp(page, input);
      await page.setViewport({ width: WHATSAPP_LARGURA, height: Math.max(altura, 1), deviceScaleFactor: 1 });
      return Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WHATSAPP_LARGURA, height: altura } }));
    }),

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

module.exports = { createExporter, ExportUnavailableError };
