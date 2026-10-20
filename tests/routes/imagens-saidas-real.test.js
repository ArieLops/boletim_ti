process.env.BOLETIM_TEST_DB = 'boletim_test_rt_imgreal';
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, PNG_SIG } = require('../helpers/routes');
const { createExporter } = require('../../src/export/exporter');
const { renderEdition } = require('../../src/render/renderEdition');
const { makeFilesRepo } = require('../../src/repos/files');

let ctx, exp;
before(async () => {
  exp = createExporter({ renderHtml: renderEdition });
  ctx = await setup({ exporter: exp });
});
after(async () => {
  await ctx.close();
  await exp.close();
});

test('exportacao real com imagem em 4 tipos de bloco: PDF de 1 pagina e PNGs 1240x1754 e 1080x1527', async () => {
  const edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  const c = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Com imagens' });
  const id = c.body.id;
  const logo = fs.readFileSync(path.join(__dirname, '../../src/render/assets/logo-padrao.png'));
  const up = await edu.agent.post('/edicoes/' + id + '/imagens').set('X-CSRF-Token', edu.csrf).set('Content-Type', 'image/png').set('Accept', 'application/json').send(logo);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const im = up.body.id;
  const blocos = [
    { tipo: 'destaque', dados: { etiqueta: 'Destaque', titulo: 'Titulo do destaque', texto: 'Texto do destaque. '.repeat(8), chamada: 'Chamada', imagem: im } },
    { tipo: 'card', dados: { etiqueta: 'A', titulo: 'Card A', texto: 'Texto A. '.repeat(10), imagem: im } },
    { tipo: 'card', dados: { etiqueta: 'B', titulo: 'Card B', texto: 'Texto B. '.repeat(10), imagem: im } },
    { tipo: 'dica', dados: { titulo: 'Dica', texto: 'Texto da dica. '.repeat(6), imagem: im } },
    { tipo: 'texto', dados: { titulo: 'Texto livre', texto: 'Texto livre. '.repeat(8), imagem: im } },
  ];
  const s = await edu.put('/edicoes/' + id, { versao: 1, blocos });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const p = await edu.post('/edicoes/' + id + '/publicar');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const files = makeFilesRepo(ctx.pool);
  const pdf = (await files.getFile(id, 'pdf')).conteudo;
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 1);
  const pe = (await files.getFile(id, 'png_email')).conteudo;
  const pw = (await files.getFile(id, 'png_whatsapp')).conteudo;
  assert.ok(pe.subarray(0, 8).equals(PNG_SIG));
  assert.equal(pe.readUInt32BE(16), 1240);
  assert.equal(pe.readUInt32BE(20), 1754);
  assert.equal(pw.readUInt32BE(16), 1080);
  assert.equal(pw.readUInt32BE(20), 1527);
}, { timeout: 120000 });

// PNG paisagem valido (400x200, cinza) gerado na hora, para o navegador conseguir desenhar.
function pngPaisagem() {
  const zlib = require('node:zlib');
  const W = 400, H = 200;
  const raw = Buffer.alloc((W + 1) * H, 0x99);
  for (let y = 0; y < H; y++) raw[y * (W + 1)] = 0;
  const chunk = (tipo, dados) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corpo) >>> 0);
    return Buffer.concat([len, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('exportacao real: 8 blocos com imagem estouram a A4 (fit estouro, 409 sem confirmar, 200 com confirmar=1)', async () => {
  const edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  const id = (await edu.post('/edicoes', { mesAno: '2026-11', titulo: 'Muitas imagens' })).body.id;
  const up = await edu.agent.post('/edicoes/' + id + '/imagens').set('X-CSRF-Token', edu.csrf).set('Content-Type', 'image/png').set('Accept', 'application/json').send(pngPaisagem());
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const blocos = Array.from({ length: 8 }, (_, i) => ({ tipo: 'destaque', dados: { etiqueta: 'E' + i, titulo: 'Destaque ' + i, texto: 'Texto do destaque. '.repeat(6), chamada: 'Saiba mais', imagem: up.body.id } }));
  const s = await edu.put('/edicoes/' + id, { versao: 1, blocos });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const { edicao, blocos: bs } = await ctx.app.locals.editions.getEdition(id);
  const [cfg, logo, imagens] = await Promise.all([ctx.app.locals.settings.getSettings(), ctx.app.locals.settings.getLogo(), ctx.app.locals.images.getMany(id, [up.body.id])]);
  const fit = await exp.fit({ edicao, blocos: bs, settings: cfg, logo, imagens }, { piso: cfg.pisoReducao });
  assert.equal(fit.estouro, true, JSON.stringify(fit));
  const r = await edu.get('/edicoes/' + id + '/download/pdf');
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'conteúdo será cortado');
  const ok = await edu.agent.get('/edicoes/' + id + '/download/pdf?confirmar=1').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.subarray(0, 4).toString(), '%PDF');
}, { timeout: 120000 });
