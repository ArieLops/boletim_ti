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
