process.env.BOLETIM_TEST_DB = 'boletim_test_rt_errors';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter } = require('../helpers/routes');

let ctx, edu;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
});
after(() => ctx.close());

// Faz a lista de edições falhar com um erro cheio de detalhes internos.
async function comFalha(fn) {
  const original = ctx.app.locals.editions.listEditions;
  const logs = console.error;
  console.error = () => {};
  ctx.app.locals.editions.listEditions = async () => { throw new Error('SEGREDO: tabela edicoes quebrada em /var/app'); };
  try {
    return await fn();
  } finally {
    console.error = logs;
    ctx.app.locals.editions.listEditions = original;
  }
}

test('erro interno em página HTML renderiza erro.ejs (500) sem detalhes internos', async () => {
  const r = await comFalha(() => edu.get('/'));
  assert.equal(r.status, 500);
  assert.match(r.type, /html/);
  assert.match(r.text, /Erro interno/);
  assert.match(r.text, /href="\/"/);
  assert.ok(!/SEGREDO|\/var\/app|at .*\.js/.test(r.text));
});

test('erro interno em requisição JSON continua JSON', async () => {
  const r = await comFalha(() => edu.agent.get('/').set('Accept', 'application/json'));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { erro: 'erro interno' });
});

test('POST /login com token CSRF vencido reexibe o login com aviso e token novo (403)', async () => {
  const agent = request.agent(ctx.app);
  await agent.get('/login');
  const r = await agent.post('/login').type('form').send({ login: 'edu', senha: 'senha-edu-123', _csrf: 'vencido' });
  assert.equal(r.status, 403);
  assert.match(r.type, /html/);
  assert.match(r.text, /A página expirou; tente entrar novamente\./);
  const token = /name="_csrf" value="([^"]+)"/.exec(r.text);
  assert.ok(token && token[1] !== 'vencido');
  // o token novo funciona
  const ok = await agent.post('/login').type('form').send({ login: 'edu', senha: 'senha-edu-123', _csrf: token[1] });
  assert.equal(ok.status, 302);
});

test('POST /login sem sessão nenhuma (formulário antigo) também reexibe o login', async () => {
  const r = await request(ctx.app).post('/login').type('form').send({ login: 'edu', senha: 'x' });
  assert.equal(r.status, 403);
  assert.match(r.text, /A página expirou/);
});

test('CSRF inválido em outras rotas não muda: texto simples 403; JSON em /login segue JSON', async () => {
  const outra = await edu.agent.post('/logout').type('form').send({ _csrf: 'errado' });
  assert.equal(outra.status, 403);
  assert.equal(outra.text, 'Requisição inválida (token CSRF)');
  const j = await request(ctx.app).post('/login').set('Accept', 'application/json').send({ login: 'a', senha: 'b' });
  assert.equal(j.status, 401);
  assert.deepEqual(j.body, { erro: 'sessão expirada' });
});
