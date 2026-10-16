const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEdition } = require('../../src/render/renderEdition');
const { createExporter, ExportUnavailableError } = require('../../src/export/exporter');

const edicao = { numero: 1, mes_ano: '2026-10', titulo: 'Informações da TI para esta semana', subtitulo: 'Avisos rápidos para as equipes.' };
const card = (n, texto) => ({ id: n, ordem: n, tipo: 'card', dados: { etiqueta: 'AREA ' + n, titulo: 'Card ' + n, texto } });
const longo = 'Texto longo para testar o estouro da página. '.repeat(8);
const input = (blocos) => ({ edicao, blocos, settings: {}, logo: null });
const normal = input([
  { id: 1, ordem: 1, tipo: 'destaque', dados: { etiqueta: 'Destaque', titulo: 'Abra chamados', texto: 'Registre as solicitações.', chamada: 'Acesse o Fluig.' } },
  card(2, 'O Departamento de TI implantou o WhatsApp.'),
  card(3, 'A rede recebeu manutenção preventiva.'),
]);
const vazia = input([]);
const trinta = input(Array.from({ length: 30 }, (_, i) => card(i + 1, longo)));

let ativos = 0;
let maxAtivos = 0;
const hooks = {
  onJobStart: () => { ativos++; maxAtivos = Math.max(maxAtivos, ativos); },
  onJobEnd: () => { ativos--; },
};
const exp = createExporter({ renderHtml: renderEdition, hooks });
test.after(() => exp.close());

const ihdr = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const PNG_SIG = '89504e470d0a1a0a';

test('pdf: Buffer %PDF com exatamente 1 pagina e texto selecionavel', async () => {
  const buf = await exp.pdf(normal);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  const txt = buf.toString('latin1');
  // paginas = objetos "/Type /Page" que nao sao "/Pages" (a arvore); confere com /Count do no raiz
  const paginas = (txt.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  assert.equal(paginas, 1);
  assert.match(txt, /\/Count 1\b/);
  assert.ok(/\/Font\b/.test(txt), 'PDF tem fontes (texto vetorial, nao imagem)');
});

test('pngEmail: 1240x1754 exatos', async () => {
  const buf = await exp.pngEmail(normal);
  assert.equal(buf.subarray(0, 8).toString('hex'), PNG_SIG);
  assert.deepEqual(ihdr(buf), { w: 1240, h: 1754 });
});

test('pngWhatsapp: largura 1080 e altura do conteudo; whatsappInfo coerente', async () => {
  const buf = await exp.pngWhatsapp(normal);
  const info = await exp.whatsappInfo(normal);
  assert.equal(buf.subarray(0, 8).toString('hex'), PNG_SIG);
  assert.equal(ihdr(buf).w, 1080);
  assert.equal(ihdr(buf).h, info.altura);
  assert.equal(info.largura, 1080);
  assert.equal(info.muitoAlta, false);
  const gigante = await exp.whatsappInfo(trinta);
  assert.equal(gigante.muitoAlta, true);
  assert.ok(gigante.altura > 4000);
});

test('edicao vazia (0 blocos) exporta PDF e PNGs', async () => {
  const pdf = await exp.pdf(vazia);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(ihdr(await exp.pngEmail(vazia)), { w: 1240, h: 1754 });
  assert.equal(ihdr(await exp.pngWhatsapp(vazia)).w, 1080);
  assert.deepEqual(await exp.fit(vazia), { scale: 1, estouro: false, faltaMm: 0 });
});

test('fit: conteudo que cabe nao reduz; 30 cards longos estouram com faltaMm positivo', async () => {
  const ok = await exp.fit(normal);
  assert.equal(ok.estouro, false);
  assert.ok(ok.scale <= 1 && ok.scale >= 0.75);
  const fit = await exp.fit(trinta);
  assert.equal(fit.estouro, true);
  assert.equal(fit.scale, 0.75);
  assert.ok(fit.faltaMm > 0);
  // mesmo com estouro, A4 ainda sai (pagina cortada)
  assert.equal((await exp.pdf(trinta)).subarray(0, 4).toString(), '%PDF');
});

test('duas chamadas simultaneas terminam ambas, uma de cada vez e em ordem', async () => {
  maxAtivos = 0;
  const ordem = [];
  const a = exp.pdf(normal).then((r) => { ordem.push('a'); return r; });
  const b = exp.pngEmail(normal).then((r) => { ordem.push('b'); return r; });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.subarray(0, 4).toString(), '%PDF');
  assert.equal(rb.subarray(0, 8).toString('hex'), PNG_SIG);
  assert.deepEqual(ordem, ['a', 'b']);
  assert.equal(maxAtivos, 1);
});

test('trabalho que falha nao quebra a fila', async () => {
  const falha = createExporter({ renderHtml: (o) => { if (o.edicao.numero === 99) throw new Error('boom'); return renderEdition(o); } });
  try {
    const ruim = falha.pdf({ ...normal, edicao: { ...edicao, numero: 99 } });
    const bom = falha.pdf(normal);
    await assert.rejects(ruim, /boom/);
    assert.equal((await bom).subarray(0, 4).toString(), '%PDF');
  } finally {
    await falha.close();
  }
});

test('Chromium indisponivel: ExportUnavailableError e recupera quando o caminho e valido', async () => {
  const original = process.env.CHROMIUM_PATH;
  const e = createExporter({ renderHtml: renderEdition });
  try {
    process.env.CHROMIUM_PATH = 'C:/nao/existe/chromium-inexistente.exe';
    await assert.rejects(e.pdf(normal), (err) => err instanceof ExportUnavailableError && /CHROMIUM_PATH/.test(err.message));
    await assert.rejects(e.pngEmail(normal), ExportUnavailableError); // segue falhando limpo, sem travar
    if (original === undefined) delete process.env.CHROMIUM_PATH; else process.env.CHROMIUM_PATH = original;
    assert.equal((await e.pdf(normal)).subarray(0, 4).toString(), '%PDF');
  } finally {
    if (original === undefined) delete process.env.CHROMIUM_PATH; else process.env.CHROMIUM_PATH = original;
    await e.close();
  }
});

test('close: trabalhos apos o encerramento sao rejeitados', async () => {
  const e = createExporter({ renderHtml: renderEdition });
  await e.fit(vazia);
  await e.close();
  await assert.rejects(e.fit(vazia), /encerrado/);
});

const paginasPdf = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
// o Chromium headless mantem 1 aba inicial (about:blank); as paginas dos trabalhos nao podem se acumular
async function semVazamento(e) {
  const antes = await e._paginasAbertas();
  assert.ok(antes <= 1, `paginas abertas: ${antes}`);
  await e.fit(vazia);
  assert.equal(await e._paginasAbertas(), antes);
}
const validoPath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

test('PDF de 30 cards longos (estouro) tem exatamente 1 pagina', async () => {
  assert.equal(paginasPdf(await exp.pdf(trinta)), 1);
});

test('pngEmail: pagina preenche a largura (layout de 794 px ampliado) com rodape no fim', async () => {
  // as guardas de largura/rodape rodam dentro do exportador (lancam se falharem); aqui conferimos o sucesso com 3 conteudos distintos
  for (const i of [vazia, normal, trinta]) assert.deepEqual(ihdr(await exp.pngEmail(i)), { w: 1240, h: 1754 });
});

test('escala via variavel CSS no mesmo documento == render novo naquela escala (<= 0.2 mm)', async () => {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: validoPath, headless: true, args: ['--disable-gpu', '--font-render-hinting=none'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    const medir = () => page.$eval('#conteudo', (el) => el.scrollHeight * 25.4 / 96);
    for (const dados of [trinta, normal]) {
      await page.setContent(renderEdition({ ...dados, mode: 'a4', scale: 1 }), { waitUntil: 'load' });
      for (const sc of [0.9, 0.8, 0.75]) {
        await page.evaluate(async (s) => {
          document.documentElement.style.setProperty('--escala', String(s));
          await document.fonts.ready;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }, sc);
        const viaVariavel = await medir();
        const fresco = await browser.newPage();
        await fresco.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
        await fresco.setContent(renderEdition({ ...dados, mode: 'a4', scale: sc }), { waitUntil: 'load' });
        const novo = await fresco.$eval('#conteudo', (el) => el.scrollHeight * 25.4 / 96);
        await fresco.close();
        assert.ok(Math.abs(viaVariavel - novo) <= 0.2, `escala ${sc}: ${viaVariavel} vs ${novo}`);
      }
    }
  } finally {
    await browser.close();
  }
});

test('paginas sao fechadas apos os trabalhos (inclusive os que falham)', async () => {
  await exp.pdf(normal);
  await exp.pngEmail(normal);
  await semVazamento(exp);
  const e = createExporter({ renderHtml: () => { throw new Error('x'); } });
  try {
    await assert.rejects(e.pdf(normal), /x/);
    assert.ok(await e._paginasAbertas() <= 1);
  } finally {
    await e.close();
  }
});

test('relanca o navegador apos queda (close por fora e kill do processo)', async () => {
  const e = createExporter({ renderHtml: renderEdition });
  try {
    await e.fit(vazia);
    const b1 = await e._browser();
    await b1.close();
    assert.equal((await e.pdf(normal)).subarray(0, 4).toString(), '%PDF');
    const b2 = await e._browser();
    assert.notEqual(b1, b2);
    b2.process().kill('SIGKILL');
    await new Promise((r) => b2.once('disconnected', r));
    assert.equal(ihdr(await e.pngWhatsapp(normal)).w, 1080);
    assert.notEqual(await e._browser(), b2);
  } finally {
    await e.close();
  }
});

test('trabalho que excede o timeout rejeita com erro claro e o proximo da fila funciona', async () => {
  const lento = '<!doctype html><script>const t=Date.now();while(Date.now()-t<15000){}</script>';
  const e = createExporter({ renderHtml: (o) => (o.edicao.numero === 77 ? lento : renderEdition(o)), timeoutMs: 1500 });
  try {
    const t0 = Date.now();
    const ruim = e.pdf({ ...normal, edicao: { ...edicao, numero: 77 } });
    const bom = e.pdf(normal);
    await assert.rejects(ruim, /Tempo limite/);
    assert.ok(Date.now() - t0 < 8000, 'timeout nao esperou o loop terminar');
    assert.equal((await bom).subarray(0, 4).toString(), '%PDF');
    await semVazamento(e);
  } finally {
    await e.close();
  }
});

test('CHROMIUM_PATH apontando para arquivo que nao e Chromium (ou diretorio) -> ExportUnavailableError; recupera depois', async () => {
  const original = process.env.CHROMIUM_PATH;
  const e = createExporter({ renderHtml: renderEdition, timeoutMs: 8000 });
  try {
    process.env.CHROMIUM_PATH = process.execPath; // node, nao um navegador
    await assert.rejects(e.pdf(normal), ExportUnavailableError);
    process.env.CHROMIUM_PATH = require('node:path').dirname(process.execPath); // diretorio
    await assert.rejects(e.pdf(normal), (err) => err instanceof ExportUnavailableError && /CHROMIUM_PATH/.test(err.message));
    process.env.CHROMIUM_PATH = `  ${validoPath}  `; // espacos sao aparados
    assert.equal((await e.pdf(normal)).subarray(0, 4).toString(), '%PDF');
  } finally {
    if (original === undefined) delete process.env.CHROMIUM_PATH; else process.env.CHROMIUM_PATH = original;
    await e.close();
  }
});

test('opts.piso por chamada sobrepõe o padrão do exportador (fit, pdf, pngEmail)', async () => {
  // HTML falso: conteudo mede 1200px * escala (317 mm a 1.0; cabe em 297 mm a partir de 0.90)
  const renderHtml = () =>
    '<!doctype html><html><head><meta charset="utf-8"><style>:root{--escala:1}*{margin:0}' +
    '#conteudo{height:calc(1200px * var(--escala));background:#ccc}</style></head>' +
    '<body><div class="pagina"><div id="conteudo"></div><div class="rodape">r</div></div></body></html>';
  const e = createExporter({ renderHtml, piso: 0.75 });
  try {
    const entrada = { edicao, blocos: [], settings: {}, logo: null };
    assert.deepEqual(await e.fit(entrada), { scale: 0.9, estouro: false, faltaMm: 0 });
    const rigido = await e.fit(entrada, { piso: 1 });
    assert.equal(rigido.estouro, true);
    assert.equal(rigido.scale, 1);
    assert.ok(rigido.faltaMm > 0);
    assert.equal((await e.fit(entrada, { piso: 0.95 })).estouro, true);
    assert.equal((await e.fit(entrada, {})).scale, 0.9); // sem piso na opção: padrão
    assert.equal((await e.pdf(entrada, { piso: 1 })).subarray(0, 4).toString(), '%PDF');
    assert.deepEqual(ihdr(await e.pngEmail(entrada, { piso: 1 })), { w: 1240, h: 1754 });
  } finally {
    await e.close();
  }
});
