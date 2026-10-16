process.env.BOLETIM_TEST_DB = 'boletim_test_rt_csrf';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter } = require('../helpers/routes');

let ctx, edu;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
});
after(() => ctx.close());

const corpo = { mesAno: '2026-10', titulo: 'CSRF' };

test('JSON com token válido no cabeçalho X-CSRF-Token é aceito', async () => {
  const r = await edu.agent.post('/edicoes').set('X-CSRF-Token', edu.csrf).send(corpo);
  assert.equal(r.status, 201);
});

test('cabeçalho X-CSRF-Token errado é rejeitado com 403', async () => {
  const r = await edu.agent.post('/edicoes').set('X-CSRF-Token', 'x'.repeat(edu.csrf.length)).send(corpo);
  assert.equal(r.status, 403);
  const curto = await edu.agent.post('/edicoes').set('X-CSRF-Token', 'abc').send(corpo);
  assert.equal(curto.status, 403);
});

test('JSON sem token é rejeitado com 403 (e não cria nada)', async () => {
  const antes = (await ctx.pool.query('SELECT COUNT(*) AS n FROM edicoes'))[0][0].n;
  const r = await edu.agent.post('/edicoes').send(corpo);
  assert.equal(r.status, 403);
  const depois = (await ctx.pool.query('SELECT COUNT(*) AS n FROM edicoes'))[0][0].n;
  assert.equal(depois, antes);
});

test('token no corpo (_csrf) continua funcionando para formulários', async () => {
  const r = await edu.agent.post('/edicoes').send({ ...corpo, _csrf: edu.csrf });
  assert.equal(r.status, 201);
});

test('JSON malformado devolve 400 JSON sem stack trace', async () => {
  const r = await edu.agent.post('/edicoes').set('X-CSRF-Token', edu.csrf).set('Content-Type', 'application/json').send('{"mesAno": ');
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'JSON inválido');
  assert.ok(!/at .*\.js/.test(r.text));
});

test('JSON acima de 1 MB devolve 413', async () => {
  const r = await edu.agent.post('/edicoes').set('X-CSRF-Token', edu.csrf).send({ ...corpo, subtitulo: 'a'.repeat(1100 * 1024) });
  assert.equal(r.status, 413);
});
