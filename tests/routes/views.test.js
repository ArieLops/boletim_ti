process.env.BOLETIM_TEST_DB = 'boletim_test_rt_views';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');

let ctx, admin, edu, ana, id;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  admin = await entrar(ctx.app, 'admin', 'senha-admin-123');
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
  const c = await ana.post('/edicoes', { mesAno: '2026-10', titulo: 'Edição <script>alert(1)</script>', subtitulo: 'Sub "aspas"' });
  id = c.body.id;
  const s = await ana.put(`/edicoes/${id}`, {
    versao: 1,
    campos: {},
    blocos: [blocoCard(1), { tipo: 'dica', dados: { titulo: 'Dica <b>x</b>', texto: 'Cuidado' } }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.body));
});
after(() => ctx.close());

const semScript = (html) => assert.ok(!/<script>alert\(1\)<\/script>/.test(html), 'HTML não escapado');

test('anônimo é redirecionado ao login nas telas', async () => {
  for (const u of ['/', '/edicoes/nova', `/edicoes/${id}`, `/edicoes/${id}/historico`, '/configuracoes']) {
    const r = await request(ctx.app).get(u);
    assert.equal(r.status, 302, u);
    assert.equal(r.headers.location, '/login');
  }
});

test('GET / lista: botão Nova edição, edição criada e último editor escapados', async () => {
  const r = await edu.get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /html/);
  assert.match(r.text, /Nova edição/);
  assert.match(r.text, /href="\/edicoes\/nova"/);
  assert.match(r.text, new RegExp(`href="/edicoes/${id}"`));
  assert.match(r.text, /Ana &lt;Editora&gt;/);
  assert.match(r.text, /Rascunho/i);
  assert.match(r.text, /Outubro\/2026/);
  semScript(r.text);
  assert.match(r.text, /Edição &lt;script&gt;/);
  // barra de navegação: nome do usuário e logout com CSRF
  assert.match(r.text, /Edu/);
  assert.match(r.text, /action="\/logout"/);
  assert.match(r.text, /name="_csrf" value="[0-9a-f]{64}"/);
});

test('nav mostra Usuários/Configurações só para administrador', async () => {
  assert.doesNotMatch((await edu.get('/')).text, /href="\/usuarios"/);
  const a = (await admin.get('/')).text;
  assert.match(a, /href="\/usuarios"/);
  assert.match(a, /href="\/configuracoes"/);
});

test('GET /edicoes/nova vem antes de /:id e traz o campo Número preenchido com o sugerido', async () => {
  const r = await edu.get('/edicoes/nova');
  assert.equal(r.status, 200);
  assert.match(r.text, /<form[^>]*id="form-nova"/);
  assert.match(r.text, /name="mesAno"/);
  assert.match(r.text, /name="titulo"/);
  assert.match(r.text, /<input[^>]*name="numero"[^>]*type="number"[^>]*value="2"|<input[^>]*type="number"[^>]*name="numero"[^>]*value="2"/);
  assert.match(r.text, /name="numero"[^>]*min="1"/);
  assert.match(r.text, /id="erro-numero"/);
});

test('editor: botões, token CSRF para o JS, blocos e campos habilitados', async () => {
  const r = await edu.get(`/edicoes/${id}`);
  assert.equal(r.status, 200);
  for (const t of ['Baixar PDF', 'Baixar PNG (e-mail)', 'Baixar imagem (WhatsApp)', 'Publicar', 'Histórico']) assert.ok(r.text.includes(t), t);
  assert.match(r.text, /<meta name="csrf-token" content="[0-9a-f]{64}">/);
  assert.match(r.text, /data-edicao-id="/);
  assert.match(r.text, /data-versao="2"/);
  assert.match(r.text, /data-id="\d+" data-tipo="card"/);
  assert.match(r.text, /data-tipo="dica"/);
  assert.match(r.text, /Dica &lt;b&gt;x&lt;\/b&gt;/);
  semScript(r.text);
  assert.match(r.text, /editor-lib\.js/);
  assert.match(r.text, /editor\.js/);
  for (const t of ['Destaque', 'Card', 'Dica', 'Texto livre']) assert.ok(r.text.includes(t), t);
  assert.doesNotMatch(r.text, /<input[^>]*name="titulo"[^>]*\bdisabled\b/);
  assert.match(r.text, /<input[^>]*name="numero"[^>]*readonly/);
});

test('edição publicada: editor travado (campos disabled) com Reabrir', async () => {
  const pub = await ana.post('/edicoes', { mesAno: '2026-11', titulo: 'Publicada' });
  await ana.put(`/edicoes/${pub.body.id}`, { versao: 1, campos: {}, blocos: [blocoCard(1)] });
  assert.equal((await ana.post(`/edicoes/${pub.body.id}/publicar`, {})).status, 200);
  const r = await edu.get(`/edicoes/${pub.body.id}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Reabrir/);
  assert.match(r.text, /<input[^>]*name="titulo"[^>]*\bdisabled\b/);
  assert.match(r.text, /<textarea[^>]*name="texto"[^>]*\bdisabled\b/);
  assert.match(r.text, /data-publicada="1"/);
  assert.match(r.text, /Publicada/);
});

test('histórico lista os eventos com o nome do usuário (escapado)', async () => {
  const r = await edu.get(`/edicoes/${id}/historico`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Ana &lt;Editora&gt;/);
  assert.match(r.text, /alterou|adicionou/);
  assert.match(r.text, /criou a edição/);
  assert.match(r.text, new RegExp(`href="/edicoes/${id}"`));
  assert.doesNotMatch(r.text, /<Editora>/);
});

test('edição inexistente ou id malformado: 404 em HTML amigável', async () => {
  for (const u of ['/edicoes/99999', '/edicoes/abc', '/edicoes/99999/historico']) {
    const r = await edu.get(u);
    assert.equal(r.status, 404, u);
    assert.match(r.type, /html/);
    assert.match(r.text, /não encontrada/i);
    assert.match(r.text, /href="\//);
  }
});

test('/usuarios e /configuracoes: editor 403 em HTML; administrador 200', async () => {
  for (const u of ['/usuarios', '/configuracoes']) {
    const e = await edu.get(u);
    assert.equal(e.status, 403, u);
    assert.match(e.type, /html/);
    assert.match(e.text, /Acesso negado/);
    assert.equal((await admin.get(u)).status, 200, u);
  }
});

test('/usuarios (administrador): nomes escapados e ações', async () => {
  const r = await admin.get('/usuarios');
  assert.match(r.text, /Ana &lt;Editora&gt;/);
  assert.doesNotMatch(r.text, /<Editora>/);
  assert.match(r.text, /Redefinir senha/);
  assert.match(r.text, /Desativar/);
});

test('/configuracoes (administrador): campos, token e script', async () => {
  const r = await admin.get('/configuracoes');
  for (const n of ['emailTi', 'rodape', 'subtitulo', 'pisoReducao']) assert.match(r.text, new RegExp(`name="${n}"`), n);
  assert.match(r.text, /name="--verde-escuro"/);
  assert.match(r.text, /<meta name="csrf-token"/);
  assert.match(r.text, /configuracoes\.js/);
  assert.match(r.text, /type="file"/);
});

test('login e troca de senha estilizados (layout compartilhado) e arquivos estáticos', async () => {
  const l = await request(ctx.app).get('/login');
  assert.match(l.text, /app\.css/);
  assert.match(l.text, /name="_csrf"/);
  assert.equal((await request(ctx.app).get('/app.css')).status, 200);
  assert.equal((await request(ctx.app).get('/editor-lib.js')).status, 200);
  assert.equal((await request(ctx.app).get('/editor.js')).status, 200);
});

test('API JSON continua funcionando com as telas montadas', async () => {
  assert.equal((await admin.get('/api/configuracoes')).status, 200);
  const j = await ana.agent.get(`/edicoes/${id}/preview`);
  assert.equal(j.status, 200);
  assert.equal(j.headers['x-ajuste'], '100');
  const sem = await request(ctx.app).get(`/edicoes/${id}`).set('Accept', 'application/json');
  assert.equal(sem.status, 401);
});

test('PUT devolve os ids dos blocos na ordem enviada', async () => {
  const c = await ana.post('/edicoes', { mesAno: '2026-12', titulo: 'Ids' });
  const s = await ana.put(`/edicoes/${c.body.id}`, { versao: 1, campos: {}, blocos: [blocoCard(1), blocoCard(2)] });
  assert.equal(s.status, 200);
  assert.equal(s.body.versao, 2);
  assert.equal(s.body.blocos.length, 2);
  assert.ok(s.body.blocos.every((b) => Number.isInteger(b.id)));
  const s2 = await ana.put(`/edicoes/${c.body.id}`, {
    versao: 2, campos: {}, blocos: [{ ...blocoCard(2), id: s.body.blocos[1].id }, { ...blocoCard(1), id: s.body.blocos[0].id }],
  });
  assert.deepEqual(s2.body.blocos.map((b) => b.id), [s.body.blocos[1].id, s.body.blocos[0].id]);
});
