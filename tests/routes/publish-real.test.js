process.env.BOLETIM_TEST_DB = 'boletim_test_rt_real';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, blocoCard, PNG_SIG } = require('../helpers/routes');
const { createExporter } = require('../../src/export/exporter');
const { renderEdition } = require('../../src/render/renderEdition');
const { makeFilesRepo } = require('../../src/repos/files');

let ctx, exp, edu;
before(async () => {
  exp = createExporter({ renderHtml: renderEdition });
  ctx = await setup({ exporter: exp });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
});
after(async () => {
  await ctx.close();
  await exp.close();
});

test('integração com Chromium real: publicar guarda PDF e PNGs válidos', async () => {
  const c = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Integração' });
  const id = c.body.id;
  const s = await edu.put(`/edicoes/${id}`, { versao: 1, blocos: [blocoCard(1), blocoCard(2)] });
  assert.equal(s.status, 200);
  const prev = await edu.get(`/edicoes/${id}/preview`);
  assert.equal(prev.status, 200);
  assert.equal(prev.headers['x-ajuste'], '100');
  const p = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const files = makeFilesRepo(ctx.pool);
  assert.equal((await files.getFile(id, 'pdf')).conteudo.subarray(0, 4).toString(), '%PDF');
  const pe = (await files.getFile(id, 'png_email')).conteudo;
  const pw = (await files.getFile(id, 'png_whatsapp')).conteudo;
  assert.ok(pe.subarray(0, 8).equals(PNG_SIG));
  assert.ok(pw.subarray(0, 8).equals(PNG_SIG));
  assert.equal(pe.readUInt32BE(16), 1240);
  assert.equal(pw.readUInt32BE(16), 1080);
}, { timeout: 120000 });
