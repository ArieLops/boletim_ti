process.env.BOLETIM_TEST_DB = 'boletim_test_editor_link';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');
const { createApp } = require('../../src/app');

let ctx, edu, appPref, eduPref;
before(async () => {
  const ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  appPref = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: '/boletim_ti' });
  eduPref = await entrar(appPref, 'edu', 'senha-edu-123', '/boletim_ti');
});
after(async () => {
  await appPref.locals.close();
  await ctx.close();
});

const nova = async (titulo = 'Edição') => {
  const r = await edu.post('/edicoes', { mesAno: '2026-10', titulo });
  await edu.put(`/edicoes/${r.body.id}`, { versao: 1, blocos: [blocoCard(1)] });
  return r.body.id;
};

test('edição nunca publicada não tem a faixa', async () => {
  const id = await nova();
  const r = await edu.get(`/edicoes/${id}`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /id="link-publico"/);
  assert.doesNotMatch(r.text, /btn-copiar-link/);
});

test('edição publicada mostra a faixa com token, campo somente leitura e botão', async () => {
  const id = await nova();
  const { body } = await edu.post(`/edicoes/${id}/publicar`);
  const r = await edu.get(`/edicoes/${id}`);
  assert.match(r.text, /id="link-publico"/);
  assert.ok(r.text.includes(`data-token="${body.token}"`));
  assert.match(r.text, /<input[^>]*id="link-publico-url"[^>]*readonly/);
  assert.match(r.text, /id="btn-copiar-link"[^>]*>Copiar link</);
  assert.doesNotMatch(r.text, /em revisão/);
});

test('rascunho reaberto com token mostra o aviso "em revisão"', async () => {
  const id = await nova();
  const { body } = await edu.post(`/edicoes/${id}/publicar`);
  await edu.post(`/edicoes/${id}/reabrir`);
  const r = await edu.get(`/edicoes/${id}`);
  assert.ok(r.text.includes(`data-token="${body.token}"`));
  assert.match(r.text, /em revisão/);
  assert.match(r.text, /id="btn-copiar-link"/);
});

test('token é escapado ao ser renderizado', async () => {
  const id = await nova();
  await edu.post(`/edicoes/${id}/publicar`);
  await ctx.pool.query('UPDATE edicoes SET token_publico = ? WHERE id = ?', ['"><script>x</script>', id]);
  const r = await edu.get(`/edicoes/${id}`);
  assert.doesNotMatch(r.text, /<script>x<\/script>/);
  assert.match(r.text, /&#34;&gt;&lt;script&gt;/);
});

test('histórico mostra "Link público criado" para o evento link_publico_criado', async () => {
  const id = await nova();
  await edu.post(`/edicoes/${id}/publicar`);
  const r = await edu.get(`/edicoes/${id}/historico`);
  assert.match(r.text, /Link público criado/);
  assert.doesNotMatch(r.text, /link_publico_criado/);
});

test('modo prefixado: campo e links do editor mantêm o prefixo', async () => {
  const c = await eduPref.post('/boletim_ti/edicoes', { mesAno: '2026-10', titulo: 'Prefixo' });
  const id = c.body.id;
  await eduPref.put(`/boletim_ti/edicoes/${id}`, { versao: 1, blocos: [blocoCard(1)] });
  const { body } = await eduPref.post(`/boletim_ti/edicoes/${id}/publicar`);
  const r = await eduPref.get(`/boletim_ti/edicoes/${id}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /id="link-publico-url"[^>]*value="\/boletim_ti\/p\//);
  assert.ok(r.text.includes(`/boletim_ti/p/${body.token}`));
  const hrefs = [...r.text.matchAll(/\b(?:href|src|action)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
  for (const h of hrefs) assert.ok(h.startsWith('/boletim_ti/'), h);
});
