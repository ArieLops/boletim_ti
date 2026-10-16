process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_tpl_bp'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard, PNG_SIG } = require('../helpers/routes');
const { createApp } = require('../../src/app');

const PREFIXO = '/boletim_ti';
let ctx, appRaiz, appPref, id;

before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  appRaiz = ctx.app;
  appPref = createApp({ pool: ctx.pool, exporter: ctx.app.locals.exporter, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: PREFIXO });
  // Dados comuns: uma edição com blocos e histórico, e um logo, para as páginas terem links reais.
  const ana = await entrar(appRaiz, 'ana', 'senha-ana-123');
  id = (await ana.post('/edicoes', { mesAno: '2026-10', titulo: 'Edição de teste' })).body.id;
  const s = await ana.put(`/edicoes/${id}`, { versao: 1, blocos: [blocoCard(1)] });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const admin = await entrar(appRaiz, 'admin', 'senha-admin-123');
  const logo = await admin.agent.put('/api/configuracoes/logo').set('X-CSRF-Token', admin.csrf).set('Content-Type', 'image/png').send(Buffer.concat([PNG_SIG, Buffer.alloc(64, 7)]));
  assert.equal(logo.status, 200);
});
after(async () => {
  await appPref.locals.close();
  await ctx.close();
});

// Valores de href/src/action (todos os que existem na página) + o content do meta base-path.
function extrair(html) {
  const valores = [];
  const re = /\b(href|src|action)="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) valores.push({ attr: m[1], valor: m[2] });
  return valores;
}
const metaBase = (html) => {
  const m = /<meta name="base-path" content="([^"]*)">/.exec(html);
  return m ? m[1] : null;
};
const internos = (html) => extrair(html).filter((v) => v.valor.startsWith('/') && !v.valor.startsWith('//'));

function conferirPagina(res, base, rotulo) {
  assert.match(res.type, /html/, `${rotulo}: não é HTML (status ${res.status})`);
  assert.equal(metaBase(res.text), base, `${rotulo}: meta base-path`);
  const lista = internos(res.text);
  assert.ok(lista.length > 0, `${rotulo}: nenhum link interno encontrado`);
  for (const { attr, valor } of lista) {
    if (base) {
      assert.ok(valor === base || valor.startsWith(base + '/') || valor.startsWith(base + '?'), `${rotulo}: ${attr}="${valor}" sem o prefixo ${base}`);
      assert.ok(!valor.startsWith(base + base), `${rotulo}: prefixo duplicado em ${valor}`);
    } else {
      assert.ok(!valor.startsWith(PREFIXO), `${rotulo}: ${attr}="${valor}" não deveria ter prefixo no modo raiz`);
    }
  }
  return lista;
}

for (const [nome, base] of [['raiz', ''], ['prefixado', PREFIXO]]) {
  const getApp = () => (base ? appPref : appRaiz);
  const tem = (lista, attr, valor) => assert.ok(lista.some((v) => v.attr === attr && v.valor === valor), `esperava ${attr}="${valor}" em ${JSON.stringify(lista)}`);

  test(`[${nome}] login: meta, css, form action`, async () => {
    const r = await request(getApp()).get(base + '/login');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'login');
    tem(l, 'action', base + '/login');
    tem(l, 'href', base + '/app.css');
    tem(l, 'href', base + '/');
  });

  test(`[${nome}] lista: nova, edição com id, histórico, logout`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const r = await edu.get(base + '/');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'lista');
    tem(l, 'href', base + '/edicoes/nova');
    tem(l, 'href', `${base}/edicoes/${id}`);
    tem(l, 'href', `${base}/edicoes/${id}/historico`);
    tem(l, 'action', base + '/logout');
    // Editor não vê Usuários/Configurações
    assert.ok(!l.some((v) => v.valor.endsWith('/usuarios')));
  });

  test(`[${nome}] nova edição`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const r = await edu.get(base + '/edicoes/nova');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'nova');
    tem(l, 'src', base + '/api.js');
    tem(l, 'src', base + '/nova.js');
  });

  test(`[${nome}] editor: scripts, histórico`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const r = await edu.get(`${base}/edicoes/${id}`);
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'editor');
    tem(l, 'href', `${base}/edicoes/${id}/historico`);
    for (const s of ['api.js', 'editor-lib.js', 'editor.js']) tem(l, 'src', `${base}/${s}`);
  });

  test(`[${nome}] histórico`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const r = await edu.get(`${base}/edicoes/${id}/historico`);
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'historico');
    tem(l, 'href', `${base}/edicoes/${id}`);
  });

  test(`[${nome}] usuários (admin): forms com id e prefixo, navegação`, async () => {
    const admin = await entrar(getApp(), 'admin', 'senha-admin-123', base);
    const r = await admin.get(base + '/usuarios');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'usuarios');
    tem(l, 'action', base + '/usuarios');
    tem(l, 'action', `${base}/usuarios/${ctx.ids.edu}/senha`);
    tem(l, 'action', `${base}/usuarios/${ctx.ids.edu}/ativo`);
    tem(l, 'href', base + '/usuarios');
    tem(l, 'href', base + '/configuracoes');
  });

  test(`[${nome}] configurações (admin): logo, scripts`, async () => {
    const admin = await entrar(getApp(), 'admin', 'senha-admin-123', base);
    const r = await admin.get(base + '/configuracoes');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'configuracoes');
    tem(l, 'src', base + '/api/configuracoes/logo');
    tem(l, 'src', base + '/configuracoes.js');
    tem(l, 'src', base + '/api.js');
  });

  test(`[${nome}] trocar senha (troca pendente): form action`, async () => {
    const login = `tpl${nome}`;
    await ctx.users.createUser({ nome: 'Pendente', login, senha: 'senha-pend-123', perfil: 'editor' });
    const agent = request.agent(getApp());
    const pg = await agent.get(base + '/login');
    const t = /name="_csrf" value="([^"]+)"/.exec(pg.text)[1];
    const lg = await agent.post(base + '/login').type('form').send({ login, senha: 'senha-pend-123', _csrf: t });
    assert.equal(lg.headers.location, base + '/trocar-senha');
    const r = await agent.get(base + '/trocar-senha');
    assert.equal(r.status, 200);
    const l = conferirPagina(r, base, 'trocar-senha');
    tem(l, 'action', base + '/trocar-senha');
  });

  test(`[${nome}] 404 de edição inexistente, 403 e 500: página de erro com links prefixados`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const nf = await edu.get(base + '/edicoes/999999');
    assert.equal(nf.status, 404);
    tem(conferirPagina(nf, base, '404'), 'href', base + '/');

    const proibido = await edu.get(base + '/usuarios');
    assert.equal(proibido.status, 403);
    tem(conferirPagina(proibido, base, '403'), 'href', base + '/');

    const original = getApp().locals.editions.listEditions;
    const logs = console.error;
    console.error = () => {};
    getApp().locals.editions.listEditions = async () => { throw new Error('falha forçada'); };
    let erro;
    try { erro = await edu.get(base + '/'); } finally { console.error = logs; getApp().locals.editions.listEditions = original; }
    assert.equal(erro.status, 500);
    tem(conferirPagina(erro, base, '500'), 'href', base + '/');
  });

  test(`[${nome}] todo href/src interno extraído responde 200 sob o prefixo e 404 fora dele`, async () => {
    const admin = await entrar(getApp(), 'admin', 'senha-admin-123', base);
    const ativos = new Set();
    for (const rota of ['/', '/edicoes/nova', `/edicoes/${id}`, '/configuracoes', '/usuarios']) {
      const r = await admin.get(base + rota);
      for (const v of internos(r.text)) if (v.attr === 'src' || (v.attr === 'href' && /\.(css|js|png)$/.test(v.valor))) ativos.add(v.valor);
    }
    assert.ok(ativos.has(base + '/app.css') && ativos.has(base + '/api.js') && ativos.has(base + '/api/configuracoes/logo'));
    for (const url of ativos) {
      const ok = await admin.get(url);
      assert.equal(ok.status, 200, url);
      if (base) {
        const fora = await request(appPref).get(url.slice(base.length));
        assert.equal(fora.status, 404, `${url.slice(base.length)} fora do prefixo`);
      }
    }
  });
}

test('[raiz] nenhuma página contém o prefixo /boletim_ti', async () => {
  const edu = await entrar(appRaiz, 'edu', 'senha-edu-123');
  for (const rota of ['/', '/edicoes/nova', `/edicoes/${id}`]) {
    const r = await edu.get(rota);
    assert.ok(!r.text.includes(PREFIXO), rota);
    assert.equal(metaBase(r.text), '');
  }
});
