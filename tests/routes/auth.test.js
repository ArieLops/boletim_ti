process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_auth'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { resetTestDb } = require('../helpers/testdb');
const { createApp } = require('../../src/app');
const { makeUsersRepo } = require('../../src/repos/users');

let pool, app, users;
before(async () => {
  pool = await resetTestDb();
  users = makeUsersRepo(pool);
  app = createApp({ pool, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1 });
  const ed = await users.createUser({ nome: 'Edu <b>', login: 'edu', senha: 'senha-edu-123', perfil: 'editor' });
  await users.setPassword(ed, 'senha-edu-123');
  await users.createUser({ nome: 'Novo', login: 'novo', senha: 'senha-novo-123', perfil: 'editor' });
  const ad = await users.createUser({ nome: 'Admin', login: 'admin', senha: 'senha-admin-123', perfil: 'administrador' });
  await users.setPassword(ad, 'senha-admin-123');
});
after(async () => {
  await app.locals.close();
  await pool.end();
});

function extractCsrf(html) {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  assert.ok(m, 'token csrf ausente');
  return m[1];
}

// Abre sessão (GET /login) e devolve agent + token csrf
async function novoAgente() {
  const agent = request.agent(app);
  const res = await agent.get('/login');
  assert.equal(res.status, 200);
  return { agent, csrf: extractCsrf(res.text) };
}

async function login(loginName, senha, ip = '10.0.0.1') {
  const { agent, csrf } = await novoAgente();
  const res = await agent
    .post('/login')
    .set('X-Forwarded-For', ip)
    .type('form')
    .send({ login: loginName, senha, _csrf: csrf });
  return { agent, res, csrf };
}

test('sem login, GET / redireciona para /login', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('login correto: 302 e cookie httpOnly/sameSite=lax', async () => {
  const { agent, res } = await login('edu', 'senha-edu-123');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.ok(!home.text.includes('<b>'), 'nome deve estar escapado');
});

test('POST sem token CSRF é rejeitado com 403', async () => {
  const res = await request(app).post('/login').type('form').send({ login: 'edu', senha: 'senha-edu-123' });
  assert.equal(res.status, 403);
  const { agent } = await login('edu', 'senha-edu-123', '10.0.0.2');
  const out = await agent.post('/logout').type('form').send({});
  assert.equal(out.status, 403);
});

test('logout com token encerra a sessão', async () => {
  const { agent } = await login('edu', 'senha-edu-123', '10.0.0.3');
  const csrf = extractCsrf((await agent.get('/')).text);
  const out = await agent.post('/logout').type('form').send({ _csrf: csrf });
  assert.equal(out.status, 302);
  const home = await agent.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/login');
});

test('usuário com trocar_senha é levado a /trocar-senha', async () => {
  const { agent, res } = await login('novo', 'senha-novo-123', '10.0.0.4');
  assert.equal(res.status, 302);
  const home = await agent.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/trocar-senha');
  const page = await agent.get('/trocar-senha');
  assert.equal(page.status, 200);
});

test('trocar-senha valida tamanho/confirmação e libera o acesso', async () => {
  const { agent } = await login('novo', 'senha-novo-123', '10.0.0.4');
  const csrf = extractCsrf((await agent.get('/trocar-senha')).text);
  const curta = await agent.post('/trocar-senha').type('form').send({ senha: 'curta', confirmacao: 'curta', _csrf: csrf });
  assert.equal(curta.status, 400);
  const dif = await agent
    .post('/trocar-senha')
    .type('form')
    .send({ senha: 'senha-nova-456', confirmacao: 'outra-coisa', _csrf: csrf });
  assert.equal(dif.status, 400);
  const ok = await agent
    .post('/trocar-senha')
    .type('form')
    .send({ senha: 'senha-nova-456', confirmacao: 'senha-nova-456', _csrf: csrf });
  assert.equal(ok.status, 302);
  assert.equal((await agent.get('/')).status, 200);
});

test('editor em /usuarios recebe 403; sem login redireciona', async () => {
  const { agent } = await login('edu', 'senha-edu-123', '10.0.0.5');
  assert.equal((await agent.get('/usuarios')).status, 403);
  const anon = await request(app).get('/usuarios');
  assert.equal(anon.status, 302);
});

test('administrador lista, cria, redefine senha e desativa usuários', async () => {
  const { agent } = await login('admin', 'senha-admin-123', '10.0.0.6');
  const page = await agent.get('/usuarios');
  assert.equal(page.status, 200);
  const csrf = extractCsrf(page.text);
  const cria = await agent
    .post('/usuarios')
    .type('form')
    .send({ nome: 'Zeca', login: 'zeca', senha: 'senha-zeca-123', perfil: 'editor', _csrf: csrf });
  assert.equal(cria.status, 302);
  const dup = await agent
    .post('/usuarios')
    .type('form')
    .send({ nome: 'Zeca', login: 'zeca', senha: 'senha-zeca-123', perfil: 'editor', _csrf: csrf });
  assert.equal(dup.status, 400);
  const [[z]] = await pool.query("SELECT id FROM usuarios WHERE login='zeca'");
  const sen = await agent.post(`/usuarios/${z.id}/senha`).type('form').send({ senha: 'redefinida-123', _csrf: csrf });
  assert.equal(sen.status, 302);
  const u = await users.verifyLogin('zeca', 'redefinida-123');
  assert.equal(u.trocar_senha, 1);
  const des = await agent.post(`/usuarios/${z.id}/ativo`).type('form').send({ ativo: '0', _csrf: csrf });
  assert.equal(des.status, 302);
  assert.equal(await users.verifyLogin('zeca', 'redefinida-123'), null);
});

test('usuário desativado perde a sessão ativa', async () => {
  const id = await users.createUser({ nome: 'Tmp', login: 'tmp', senha: 'senha-tmp-123', perfil: 'editor' });
  await users.setPassword(id, 'senha-tmp-123');
  const { agent } = await login('tmp', 'senha-tmp-123', '10.0.0.7');
  assert.equal((await agent.get('/')).status, 200);
  await users.setActive(id, false);
  const r = await agent.get('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/login');
});

test('erro de login é genérico e, após 5 falhas, informa bloqueio', async () => {
  const ip = '10.9.9.9';
  const b = await login('fantasma', 'errada', ip);
  assert.equal(b.res.status, 401);
  assert.match(b.res.text, /Usuário ou senha inválidos/);
  for (let i = 0; i < 5; i++) {
    const r = await login('edu', 'errada', ip);
    assert.equal(r.res.status, 401);
    assert.match(r.res.text, /Usuário ou senha inválidos/);
  }
  const sexta = await login('edu', 'errada', ip);
  assert.equal(sexta.res.status, 429);
  assert.match(sexta.res.text, /temporariamente bloquead/i);
  // mesmo com a senha certa, continua bloqueado
  const certa = await login('edu', 'senha-edu-123', ip);
  assert.equal(certa.res.status, 429);
  // outro IP não é afetado
  const outro = await login('edu', 'senha-edu-123', '10.9.9.10');
  assert.equal(outro.res.status, 302);
});

test('tentativas erradas paralelas também são limitadas (429)', async () => {
  const ip = '10.8.8.8';
  const rs = await Promise.all(Array.from({ length: 10 }, () => login('edu', 'errada', ip)));
  const status = rs.map((r) => r.res.status);
  assert.ok(status.includes(429), `esperava ao menos um 429, veio ${status}`);
  assert.ok(status.filter((s) => s === 401).length <= 5);
});

test('variantes de acento/caixa/espaço do login compartilham o mesmo bloqueio', async () => {
  const ip = '10.7.7.7';
  const variantes = ['admin', 'ADMIN', 'ádmin', 'ADMÍN', 'admin ', ' Admin'];
  for (const v of variantes.slice(0, 5)) {
    const r = await login(v, 'errada', ip);
    assert.equal(r.res.status, 401);
  }
  const sexta = await login(variantes[5], 'errada', ip);
  assert.equal(sexta.res.status, 429);
});
