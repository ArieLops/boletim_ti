process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_rt_imgsaidas';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, PNG_SIG } = require('../helpers/routes');
const { createApp } = require('../../src/app');
const { createThrottle } = require('../../src/auth/throttle');

const png = Buffer.concat([PNG_SIG, Buffer.from('bytes-unicos-da-imagem-de-saida')]);
const B64 = png.toString('base64');
const MARCA = 'data:image/png;base64,' + B64;

let ctx, ex, edu, app, idPub, tokenPub, idRev, tokenRev;

async function criar(titulo, tipo = 'texto') {
  const c = await edu.post('/edicoes', { mesAno: '2026-10', titulo });
  assert.equal(c.status, 201);
  const up = await edu.agent.post('/edicoes/' + c.body.id + '/imagens').set('X-CSRF-Token', edu.csrf).set('Content-Type', 'image/png').set('Accept', 'application/json').send(png);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const blocos = [{ tipo, dados: { titulo: 'T', texto: 'X', etiqueta: 'E', chamada: 'C', imagem: up.body.id } }];
  const s = await edu.put('/edicoes/' + c.body.id, { versao: 1, blocos });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return { id: c.body.id, imagemId: up.body.id };
}

before(async () => {
  ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  app = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, publicThrottle: createThrottle({ max: 100000 }) });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  const a = await criar('Com imagem', 'destaque');
  idPub = a.id;
  const p = await edu.post('/edicoes/' + idPub + '/publicar');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  tokenPub = p.body.token;
  const b = await criar('Rascunho com imagem');
  idRev = b.id;
  const p2 = await edu.post('/edicoes/' + idRev + '/publicar');
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  tokenRev = p2.body.token;
  assert.equal((await edu.post('/edicoes/' + idRev + '/reabrir')).status, 200);
});
after(async () => {
  await app.locals.close();
  await ctx.close();
});

test('previa da edicao contem a imagem do bloco', async () => {
  const r = await edu.get('/edicoes/' + idRev + '/preview');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('<figure class="img-bloco">'));
  assert.ok(r.text.includes(MARCA));
});

test('exportador recebe input.imagens apenas com as imagens dos blocos da edicao', async () => {
  const outra = await criar('Outra edicao');
  let visto = null;
  const orig = ex.pdf;
  ex.pdf = async (i, o) => { visto = i; return orig(i, o); };
  const r = await edu.get('/edicoes/' + outra.id + '/download/pdf');
  ex.pdf = orig;
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(visto.imagens), [String(outra.imagemId)]);
  assert.ok(visto.imagens[outra.imagemId].buffer.equals(png));
});

test('pagina publica de edicao publicada leva a imagem, sem Set-Cookie', async () => {
  const r = await request(app).get('/p/' + tokenPub);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(MARCA));
  assert.ok(r.text.includes('<figure class="img-bloco">'));
  assert.equal(r.headers['set-cookie'], undefined);
  assert.match(r.headers['content-security-policy'], /img-src data:/);
});

test('pagina publica de edicao em revisao nao contem imagem', async () => {
  const r = await request(app).get('/p/' + tokenRev);
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes(B64));
  assert.ok(!r.text.includes('img-bloco'));
  assert.equal(r.headers['set-cookie'], undefined);
});
