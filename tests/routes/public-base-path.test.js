process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_public_bp';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');
const { createApp } = require('../../src/app');
const { createThrottle } = require('../../src/auth/throttle');

const PREFIXO = '/boletim_ti';
let ctx, appPref, token;

before(async () => {
  const ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  appPref = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, basePath: PREFIXO, publicThrottle: createThrottle({ max: 100000 }) });
  const edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  const c = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Com prefixo' });
  await edu.put(`/edicoes/${c.body.id}`, { versao: 1, blocos: [blocoCard(1)] });
  token = (await edu.post(`/edicoes/${c.body.id}/publicar`)).body.token;
  assert.ok(token);
});
after(async () => {
  await appPref.locals.close();
  await ctx.close();
});

test('com prefixo: página 200 e todos os links internos começam por /boletim_ti/p/<token>/baixar/', async () => {
  const r = await request(appPref).get(`${PREFIXO}/p/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['set-cookie'], undefined);
  const valores = [...r.text.matchAll(/\b(?:href|src|action)="([^"]*)"/g)].map((m) => m[1]).filter((v) => !v.startsWith('data:') && !v.startsWith('#'));
  assert.equal(valores.length, 3, JSON.stringify(valores));
  for (const v of valores) assert.ok(v.startsWith(`${PREFIXO}/p/${token}/baixar/`), v);
});

test('com prefixo: /p/<token> sem prefixo → 404 simples; PDF sob o prefixo funciona', async () => {
  const sem = await request(appPref).get(`/p/${token}`);
  assert.equal(sem.status, 404);
  assert.equal(sem.text, 'Não encontrado');
  assert.equal((await request(appPref).get(`/p/${token}/baixar/pdf`)).status, 404);
  const pdf = await request(appPref).get(`${PREFIXO}/p/${token}/baixar/pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  assert.equal(pdf.headers['content-disposition'], 'attachment; filename="comunicado-001.pdf"');
});

test('com prefixo: 404 e revisão não têm links internos; caixa do prefixo não casa', async () => {
  const n = await request(appPref).get(`${PREFIXO}/p/abc`);
  assert.equal(n.status, 404);
  assert.ok(!n.text.includes('href='));
  assert.equal((await request(appPref).get(`/BOLETIM_TI/p/${token}`)).text, 'Não encontrado');
});
