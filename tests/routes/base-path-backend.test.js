process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_basepath_be'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup } = require('../helpers/routes');
const { createApp } = require('../../src/app');
const { loadConfig } = require('../../src/config');

const PREFIXO = '/boletim_ti';
let ctx, appRaiz, appPref;

before(async () => {
  ctx = await setup();
  appRaiz = ctx.app;
  appPref = createApp({ pool: ctx.pool, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: PREFIXO });
});
after(async () => {
  await appPref.locals.close();
  await ctx.close();
});

const csrfDe = (html) => {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  assert.ok(m, 'token csrf ausente');
  return m[1];
};
const cookies = (res) => [].concat(res.headers['set-cookie'] || []);

async function logar(app, base, login, senha) {
  const agent = request.agent(app);
  const pg = await agent.get(base + '/login');
  const res = await agent.post(base + '/login').type('form').send({ login, senha, _csrf: csrfDe(pg.text) });
  return { agent, res };
}

for (const [nome, base] of [['raiz', ''], ['prefixado', PREFIXO]]) {
  const getApp = () => (base ? appPref : appRaiz);

  test(`[${nome}] GET /login 200`, async () => {
    const res = await request(getApp()).get(base + '/login');
    assert.equal(res.status, 200);
  });

  test(`[${nome}] sem sessão: / redireciona para login`, async () => {
    const res = await request(getApp()).get(base + '/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/login');
  });

  test(`[${nome}] login válido: redirect e cookie boletim.sid`, async () => {
    const { res } = await logar(getApp(), base, 'edu', 'senha-edu-123');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/');
    const c = cookies(res).find((x) => x.startsWith('boletim.sid='));
    assert.ok(c, `cookie boletim.sid ausente: ${cookies(res)}`);
    assert.match(c, new RegExp(`Path=${base || '/'};`));
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.doesNotMatch(c, /Secure/);
    assert.ok(!cookies(res).some((x) => x.startsWith('sid=')));
  });

  test(`[${nome}] logout volta ao login e expira o cookie no mesmo Path`, async () => {
    const { agent } = await logar(getApp(), base, 'edu', 'senha-edu-123');
    const home = await agent.get(base + '/');
    assert.equal(home.status, 200);
    const res = await agent.post(base + '/logout').type('form').send({ _csrf: csrfDe(home.text) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/login');
    const c = cookies(res).find((x) => x.startsWith('boletim.sid='));
    assert.ok(c, 'cookie de logout ausente');
    assert.match(c, new RegExp(`Path=${base || '/'}(;|$)`));
    assert.match(c, /Expires=Thu, 01 Jan 1970/);
  });

  test(`[${nome}] já logado: GET /login redireciona para a home`, async () => {
    const { agent } = await logar(getApp(), base, 'edu', 'senha-edu-123');
    const res = await agent.get(base + '/login');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/');
  });

  test(`[${nome}] troca de senha obrigatória`, async () => {
    const login = `novo${nome}`;
    await ctx.users.createUser({ nome: 'Novo', login, senha: 'senha-novo-123', perfil: 'editor' });
    const { agent, res } = await logar(getApp(), base, login, 'senha-novo-123');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/trocar-senha');
    const redir = await agent.get(base + '/edicoes');
    assert.equal(redir.status, 302);
    assert.equal(redir.headers.location, base + '/trocar-senha');
    const json = await agent.get(base + '/edicoes').set('Accept', 'application/json');
    assert.equal(json.status, 403);
    const pg = await agent.get(base + '/trocar-senha');
    assert.equal(pg.status, 200);
    const post = await agent.post(base + '/trocar-senha').type('form').send({ senha: 'outra-senha-123', confirmacao: 'outra-senha-123', _csrf: csrfDe(pg.text) });
    assert.equal(post.status, 302);
    assert.equal(post.headers.location, base + '/');
  });

  test(`[${nome}] sem sessão: troca de senha redireciona para login`, async () => {
    const res = await request(getApp()).get(base + '/trocar-senha');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/login');
  });

  test(`[${nome}] POST /usuarios (admin) redireciona para /usuarios`, async () => {
    const { agent } = await logar(getApp(), base, 'admin', 'senha-admin-123');
    const pg = await agent.get(base + '/usuarios');
    assert.equal(pg.status, 200);
    const login = `u${nome}${Date.now()}`;
    const res = await agent.post(base + '/usuarios').type('form').send({ nome: 'X', login, senha: 'senha-x-12345', perfil: 'editor', _csrf: csrfDe(pg.text) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, base + '/usuarios');
    const id = (await ctx.pool.query('SELECT id FROM usuarios WHERE login = ?', [login]))[0][0].id;
    const lista = await agent.get(base + '/usuarios');
    const s = await agent.post(`${base}/usuarios/${id}/senha`).type('form').send({ senha: 'senha-y-12345', _csrf: csrfDe(lista.text) });
    assert.equal(s.headers.location, base + '/usuarios');
    const a = await agent.post(`${base}/usuarios/${id}/ativo`).type('form').send({ ativo: '1', _csrf: csrfDe(lista.text) });
    assert.equal(a.headers.location, base + '/usuarios');
  });

  test(`[${nome}] JSON sem login: 401 sessão expirada`, async () => {
    const a = await request(getApp()).get(base + '/api/configuracoes');
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, { erro: 'sessão expirada' });
    const b = await request(getApp()).get(base + '/edicoes').set('Accept', 'application/json');
    assert.equal(b.status, 401);
    assert.deepEqual(b.body, { erro: 'sessão expirada' });
  });

  test(`[${nome}] CSRF inválido`, async () => {
    const { agent } = await logar(getApp(), base, 'edu', 'senha-edu-123');
    const res = await agent.post(base + '/edicoes').set('Accept', 'application/json').send({});
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { erro: 'token CSRF inválido' });
    const sem = await request(getApp()).post(base + '/edicoes').set('Accept', 'application/json').send({});
    assert.equal(sem.status, 401);
    const form = await request(getApp()).post(base + '/login').type('form').send({ login: 'edu', senha: 'senha-edu-123' });
    assert.equal(form.status, 403);
    // distingue o ramo do /login (tela de login reexibida) do tratamento genérico de CSRF
    assert.match(form.type, /html/);
    assert.match(form.text, /A página expirou/);
  });

  test(`[${nome}] estáticos (css/js) respondem 200 sem Set-Cookie`, async () => {
    for (const arq of ['app.css', 'api.js', 'editor.js', 'editor-lib.js', 'nova.js', 'configuracoes.js']) {
      const res = await request(getApp()).get(`${base}/${arq}`);
      assert.equal(res.status, 200, arq);
      assert.equal(cookies(res).length, 0, arq);
    }
  });

  test(`[${nome}] /saude`, async () => {
    const res = await request(getApp()).get(base + '/saude');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(cookies(res).length, 0);
  });
}

test('/saude na raiz também funciona no modo prefixado, sem cookie', async () => {
  const res = await request(appPref).get('/saude');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(cookies(res).length, 0);
});

test('[prefixado] fora do prefixo: 404 texto simples, sem Set-Cookie', async () => {
  for (const url of ['/login', '/api/configuracoes', '/edicoes/1', '/', '/boletim_tiXYZ/login', '/boletim_tiXYZ', '/outra/coisa']) {
    const res = await request(appPref).get(url);
    assert.equal(res.status, 404, url);
    assert.equal(res.text, 'Não encontrado', url);
    assert.match(res.headers['content-type'], /text\/plain/, url);
    assert.equal(cookies(res).length, 0, url);
  }
  const post = await request(appPref).post('/login').type('form').send({ login: 'edu', senha: 'x' });
  assert.equal(post.status, 404);
  assert.equal(cookies(post).length, 0);
});

test('[prefixado] estáticos fora do prefixo: 404', async () => {
  for (const url of ['/app.css', '/api.js', '/editor.js']) {
    const res = await request(appPref).get(url);
    assert.equal(res.status, 404, url);
    assert.equal(cookies(res).length, 0, url);
  }
});

test('[prefixado] prefixo em caixa diferente: 404 sem Set-Cookie (roteamento sensível a maiúsculas)', async () => {
  for (const url of ['/BOLETIM_TI/login', '/Boletim_Ti/login', '/BOLETIM_TI/app.css']) {
    const res = await request(appPref).get(url);
    assert.equal(res.status, 404, url);
    assert.equal(cookies(res).length, 0, url);
  }
});

test('[prefixado] GET /boletim_ti sem barra não é 500', async () => {
  const res = await request(appPref).get(PREFIXO);
  assert.ok([200, 301, 302].includes(res.status), `status ${res.status}`);
  if (res.status === 301) assert.equal(res.headers.location, PREFIXO + '/');
  if (res.status === 302) assert.equal(res.headers.location, PREFIXO + '/login');
});

test('[prefixado] barra dupla dentro do prefixo: 404 sem 500', async () => {
  for (const url of [PREFIXO + '//login', PREFIXO + '//', PREFIXO + '/%2e%2e/login']) {
    const res = await request(appPref).get(url);
    assert.ok(res.status < 500, `${url} -> ${res.status}`);
  }
  const res = await request(appPref).get(PREFIXO + '//login');
  assert.equal(res.status, 404);
});

test('[raiz] /boletim_ti/login é 404', async () => {
  const res = await request(appRaiz).get(PREFIXO + '/login');
  assert.equal(res.status, 404);
});

test('app.locals.url e basePath', () => {
  assert.equal(appPref.locals.basePath, PREFIXO);
  assert.equal(appPref.locals.url('/login'), PREFIXO + '/login');
  assert.equal(appRaiz.locals.basePath, '');
  assert.equal(appRaiz.locals.url('/'), '/');
});

test('createApp normaliza basePath defensivamente e rejeita inválido', async () => {
  const opts = { pool: ctx.pool, cookieSecure: false, sessionSecret: 's', sessionHours: 1 };
  const a = createApp({ ...opts, basePath: '/x/' });
  assert.equal(a.locals.basePath, '/x');
  await a.locals.close();
  assert.throws(() => createApp({ ...opts, basePath: '//evil.com' }), /BASE_PATH inválido/);
});

test('loadConfig: basePath normalizado e erro claro para inválido', () => {
  const env = { SESSION_SECRET: 's', DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' };
  assert.equal(loadConfig(env).basePath, '');
  assert.equal(loadConfig({ ...env, BASE_PATH: '/boletim_ti/' }).basePath, '/boletim_ti');
  assert.throws(() => loadConfig({ ...env, BASE_PATH: 'http://x' }), /^Error: BASE_PATH inválido/);
});
