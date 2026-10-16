process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_flows_bp'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard, PNG_SIG } = require('../helpers/routes');
const { createApp } = require('../../src/app');
const { makeFilesRepo } = require('../../src/repos/files');

const PREFIXO = '/boletim_ti';
let ctx, exp, appRaiz, appPref;

before(async () => {
  exp = fakeExporter();
  ctx = await setup({ exporter: exp });
  appRaiz = ctx.app;
  appPref = createApp({ pool: ctx.pool, exporter: exp, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: PREFIXO });
});
after(async () => {
  await appPref.locals.close();
  await ctx.close();
});

const binario = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

for (const [nome, base] of [['raiz', ''], ['prefixado', PREFIXO]]) {
  const getApp = () => (base ? appPref : appRaiz);

  test(`[${nome}] ciclo da edição: criar, salvar (saveToken), prévia, baixar, publicar, reabrir, histórico`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const c = await edu.post(base + '/edicoes', { mesAno: '2026-10', titulo: `Fluxo ${nome}` });
    assert.equal(c.status, 201);
    const id = c.body.id;
    assert.ok(id);

    const corpo = { versao: 1, saveToken: `tok-${nome}`, blocos: [blocoCard(1), blocoCard(2)] };
    const s = await edu.put(`${base}/edicoes/${id}`, corpo);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.repetido, undefined);
    const rep = await edu.put(`${base}/edicoes/${id}`, corpo); // resposta "perdida": repete com versão antiga
    assert.equal(rep.status, 200);
    assert.equal(rep.body.repetido, true);

    const prev = await edu.get(`${base}/edicoes/${id}/preview`);
    assert.equal(prev.status, 200);
    assert.match(prev.type, /html/);
    assert.ok(prev.headers['x-ajuste'], 'X-Ajuste ausente');

    const p = await edu.post(`${base}/edicoes/${id}/publicar`);
    assert.equal(p.status, 200, JSON.stringify(p.body));

    const files = makeFilesRepo(ctx.pool);
    const esperado = { pdf: ['pdf', 'application/pdf', `comunicado-`], 'png-email': ['png_email', 'image/png', '-email.png'], 'png-whatsapp': ['png_whatsapp', 'image/png', '-whatsapp.png'] };
    for (const [tipo, [coluna, mime, sufixo]] of Object.entries(esperado)) {
      const d = await edu.agent.get(`${base}/edicoes/${id}/download/${tipo}`).buffer(true).parse(binario);
      assert.equal(d.status, 200, tipo);
      assert.match(d.headers['content-type'], new RegExp(mime.replace('/', '\\/')), tipo);
      assert.ok(d.body.equals((await files.getFile(id, coluna)).conteudo), `${tipo}: bytes diferentes do banco`);
      const cd = d.headers['content-disposition'];
      assert.match(cd, /^attachment; filename="comunicado-[^"]+"$/, tipo);
      assert.ok(cd.includes(sufixo), `${tipo}: ${cd}`);
      if (tipo.startsWith('png')) assert.ok(d.body.subarray(0, 8).equals(PNG_SIG));
    }

    const re = await edu.post(`${base}/edicoes/${id}/reabrir`);
    assert.equal(re.status, 200, JSON.stringify(re.body));

    const h = await edu.get(`${base}/edicoes/${id}/historico`);
    assert.equal(h.status, 200);
    assert.match(h.text, /Histórico/);
    assert.match(h.text, /<li>/); // eventos registrados (criou, salvou, publicou, reabriu)
    assert.ok(h.text.includes(`href="${base}/edicoes/${id}"`));
  });

  test(`[${nome}] configurações, logo e usuários`, async () => {
    const admin = await entrar(getApp(), 'admin', 'senha-admin-123', base);
    const cfg = await admin.post(base + '/api/configuracoes', { rodape: `Rodapé ${nome}` });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));

    const png = Buffer.concat([PNG_SIG, Buffer.alloc(64, 3)]);
    const up = await admin.agent.put(base + '/api/configuracoes/logo').set('X-CSRF-Token', admin.csrf).set('Content-Type', 'image/png').send(png);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const g = await admin.agent.get(base + '/api/configuracoes/logo').buffer(true).parse(binario);
    assert.equal(g.status, 200);
    assert.equal(g.headers['content-type'], 'image/png');
    assert.ok(g.body.equals(png));

    const login = `fl${nome}`;
    const pg = await admin.get(base + '/usuarios');
    const novo = await admin.agent.post(base + '/usuarios').type('form').send({ nome: 'Fluxo', login, senha: 'senha-fl-12345', perfil: 'editor', _csrf: admin.csrf });
    assert.equal(novo.status, 302);
    assert.equal(novo.headers.location, base + '/usuarios');
    assert.equal(pg.status, 200);
    const uid = (await ctx.pool.query('SELECT id FROM usuarios WHERE login = ?', [login]))[0][0].id;
    const reset = await admin.agent.post(`${base}/usuarios/${uid}/senha`).type('form').send({ senha: 'outra-12345678', _csrf: admin.csrf });
    assert.equal(reset.headers.location, base + '/usuarios');
    const des = await admin.agent.post(`${base}/usuarios/${uid}/ativo`).type('form').send({ ativo: '0', _csrf: admin.csrf });
    assert.equal(des.headers.location, base + '/usuarios');
    const ativo = (await ctx.pool.query('SELECT ativo FROM usuarios WHERE id = ?', [uid]))[0][0].ativo;
    assert.equal(ativo, 0);
  });

  test(`[${nome}] CSRF inválido dá 403 JSON e sessão expirada dá 401 JSON`, async () => {
    const edu = await entrar(getApp(), 'edu', 'senha-edu-123', base);
    const sem = await edu.agent.post(base + '/edicoes').set('Accept', 'application/json').send({ mesAno: '2026-10', titulo: 'x' });
    assert.equal(sem.status, 403);
    assert.deepEqual(sem.body, { erro: 'token CSRF inválido' });
    const anonimo = await request(getApp()).put(`${base}/edicoes/1`).set('Accept', 'application/json').send({});
    assert.equal(anonimo.status, 401);
    assert.deepEqual(anonimo.body, { erro: 'sessão expirada' });
    const api = await request(getApp()).get(base + '/api/configuracoes/logo');
    assert.equal(api.status, 401);
  });
}
