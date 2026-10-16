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

// --- Contrato de erros JSON para chamadas fetch (ver wantsJson em src/auth/middleware.js) ---
const request = require('supertest');

test('anônimo: PUT/POST com JSON ou só Accept JSON recebe 401 JSON; /api/ também', async () => {
  const a = await request(ctx.app).put('/edicoes/1').send({ versao: 1, blocos: [] });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, { erro: 'sessão expirada' });
  const b = await request(ctx.app).post('/edicoes/1/publicar').set('Accept', 'application/json');
  assert.equal(b.status, 401);
  assert.deepEqual(b.body, { erro: 'sessão expirada' });
  const c = await request(ctx.app).get('/api/configuracoes');
  assert.equal(c.status, 401);
  assert.deepEqual(c.body, { erro: 'sessão expirada' });
  const d = await request(ctx.app).get('/edicoes/1/preview').set('Accept', 'application/json');
  assert.equal(d.status, 401);
});

test('navegação de browser sem sessão continua redirecionando para /login', async () => {
  const r = await request(ctx.app).get('/edicoes/1/preview').set('Accept', 'text/html');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/login');
  assert.equal((await request(ctx.app).get('/edicoes/1/download/pdf')).status, 302);
});

test('editor em /api/configuracoes: 403 JSON; navegação /usuarios mantém texto', async () => {
  const r = await edu.get('/api/configuracoes');
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { erro: 'acesso restrito a administradores' });
  const u = await edu.get('/usuarios');
  assert.equal(u.status, 403);
  assert.equal(u.text, 'Acesso negado');
});

test('falha de CSRF com JSON: 403 JSON; formulário mantém texto', async () => {
  const r = await edu.agent.post('/edicoes').send(corpo);
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { erro: 'token CSRF inválido' });
  const f = await edu.agent.post('/logout').type('form').send({});
  assert.equal(f.status, 403);
  assert.match(f.text, /token CSRF/);
});

test('usuário com troca de senha pendente: 403 JSON em chamadas fetch; redirect em navegação', async () => {
  await ctx.users.createUser({ nome: 'Pendente', login: 'pend', senha: 'senha-pend-123', perfil: 'editor' });
  const agent = request.agent(ctx.app);
  const pg = await agent.get('/login');
  const t0 = /name="_csrf" value="([^"]+)"/.exec(pg.text)[1];
  assert.equal((await agent.post('/login').type('form').send({ login: 'pend', senha: 'senha-pend-123', _csrf: t0 })).status, 302);
  const csrf = /name="_csrf" value="([^"]+)"/.exec((await agent.get('/trocar-senha')).text)[1];
  const r = await agent.put('/edicoes/1').set('X-CSRF-Token', csrf).send({ versao: 1, blocos: [] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { erro: 'troca de senha obrigatória' });
  const nav = await agent.get('/edicoes/1/preview');
  assert.equal(nav.status, 302);
  assert.equal(nav.headers.location, '/trocar-senha');
});
