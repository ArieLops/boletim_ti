process.env.BOLETIM_TEST_DB = 'boletim_test_editor_imagem';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter, PNG_SIG } = require('../helpers/routes');
const { createApp } = require('../../src/app');

const PREFIXO = '/boletim_ti';
const png = Buffer.concat([PNG_SIG, Buffer.alloc(64, 7)]);
let ctx, appPref, ana, anaPref, id, pubId, imgId, imgPubId, idPref, imgPrefId;

const enviar = (a, edId, base = '') => a.agent.post(`${base}/edicoes/${edId}/imagens`).set('X-CSRF-Token', a.csrf).set('Content-Type', 'image/png').set('Accept', 'application/json').send(png);

before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  appPref = createApp({ pool: ctx.pool, exporter: ctx.app.locals.exporter, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: PREFIXO });
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
  id = (await ana.post('/edicoes', { mesAno: '2026-10', titulo: 'Img' })).body.id;
  imgId = (await enviar(ana, id)).body.id;
  const s = await ana.put(`/edicoes/${id}`, { versao: 1, campos: {}, blocos: [
    { tipo: 'texto', dados: { titulo: 'Com', texto: 'T', imagem: imgId } },
    { tipo: 'texto', dados: { titulo: 'Sem', texto: 'T' } },
  ] });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  pubId = (await ana.post('/edicoes', { mesAno: '2026-11', titulo: 'Pub' })).body.id;
  imgPubId = (await enviar(ana, pubId)).body.id;
  await ana.put(`/edicoes/${pubId}`, { versao: 1, campos: {}, blocos: [{ tipo: 'texto', dados: { titulo: 'P', texto: 'T', imagem: imgPubId } }] });
  assert.equal((await ana.post(`/edicoes/${pubId}/publicar`, {})).status, 200);
  anaPref = await entrar(appPref, 'ana', 'senha-ana-123', PREFIXO);
  idPref = (await anaPref.post(PREFIXO + '/edicoes', { mesAno: '2026-12', titulo: 'Pref' })).body.id;
  imgPrefId = (await enviar(anaPref, idPref, PREFIXO)).body.id;
  const s2 = await anaPref.put(`${PREFIXO}/edicoes/${idPref}`, { versao: 1, campos: {}, blocos: [{ tipo: 'card', dados: { etiqueta: 'E', titulo: 'T', texto: 'X', imagem: imgPrefId } }] });
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
});
after(async () => { await appPref.locals.close(); await ctx.close(); });

const blocosHtml = (html) => html.split('<template')[0].match(/<li class="bloco-item"[\s\S]*?<\/li>/g) || [];

test('rascunho: cada bloco tem campo de imagem com accept e botão de remover', async () => {
  const lis = blocosHtml((await ana.get(`/edicoes/${id}`)).text);
  assert.equal(lis.length, 2);
  for (const li of lis) {
    assert.match(li, /class="bloco-imagem"/);
    assert.match(li, /<input[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"|<input[^>]*accept="image\/png,image\/jpeg,image\/webp"[^>]*type="file"/);
    assert.match(li, /data-acao="remover-imagem"/);
    assert.doesNotMatch(li, /<input[^>]*type="file"[^>]*name=/);
  }
});

test('bloco com imagem: data-imagem e miniatura com src da imagem; sem imagem: sem data-imagem', async () => {
  const lis = blocosHtml((await ana.get(`/edicoes/${id}`)).text);
  assert.match(lis[0], new RegExp(`data-imagem="${imgId}"`));
  assert.match(lis[0], new RegExp(`<img[^>]*src="/edicoes/${id}/imagens/${imgId}"`));
  assert.doesNotMatch(lis[1], /data-imagem=/);
  assert.doesNotMatch(lis[1], /<img[^>]*src=/);
});

test('cada template de tipo traz o campo de imagem', async () => {
  const html = (await ana.get(`/edicoes/${id}`)).text;
  for (const tipo of ['destaque', 'card', 'dica', 'texto']) {
    const i = html.indexOf(`<template id="tpl-${tipo}">`);
    assert.ok(i >= 0, tipo);
    const m = [html.slice(i, html.indexOf('</template>', i))];
    assert.match(m[0], /data-tipo="/);
    assert.match(m[0], /class="bloco-imagem"/);
    assert.match(m[0], /accept="image\/png,image\/jpeg,image\/webp"/);
  }
});

test('modo prefixado: miniatura com o prefixo /boletim_ti', async () => {
  const html = (await anaPref.get(`${PREFIXO}/edicoes/${idPref}`)).text;
  assert.match(html, new RegExp(`<img[^>]*src="${PREFIXO}/edicoes/${idPref}/imagens/${imgPrefId}"`));
  assert.doesNotMatch(html, new RegExp(`src="${PREFIXO}${PREFIXO}`));
});

test('edição publicada: miniatura sem input nem botão de remover', async () => {
  const lis = blocosHtml((await ana.get(`/edicoes/${pubId}`)).text);
  assert.equal(lis.length, 1);
  assert.match(lis[0], new RegExp(`<img[^>]*src="/edicoes/${pubId}/imagens/${imgPubId}"`));
  assert.doesNotMatch(lis[0], /type="file"/);
  assert.doesNotMatch(lis[0], /remover-imagem/);
});
