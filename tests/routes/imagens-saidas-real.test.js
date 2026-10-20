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
