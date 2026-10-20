process.env.BOLETIM_TEST_DB = 'boletim_test_rt_imagens';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, PNG_SIG } = require('../helpers/routes');

let ctx, edu, ana, ed1, ed2;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
  ed1 = await ctx.app.locals.editions.createEdition({ numero: 1, mesAno: '2026-10', titulo: 'E1' }, ctx.ids.edu);
  ed2 = await ctx.app.locals.editions.createEdition({ numero: 2, mesAno: '2026-10', titulo: 'E2' }, ctx.ids.edu);
});
after(() => ctx.close());

const png = Buffer.concat([PNG_SIG, Buffer.alloc(64, 7)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(16, 5)]);
const enviar = (a, id, corpo, tipo = 'image/png') =>
  a.agent.post(`/edicoes/${id}/imagens`).set('X-CSRF-Token', a.csrf).set('Content-Type', tipo).set('Accept', 'application/json').send(corpo);
const binario = (r) => { r.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }); return r; };

test('sem login: 401; sem CSRF: 403', async () => {
  const r = await request(ctx.app).post(`/edicoes/${ed1}/imagens`).set('Content-Type', 'image/png').set('Accept', 'application/json').send(png);
  assert.equal(r.status, 401);
  const r2 = await edu.agent.post(`/edicoes/${ed1}/imagens`).set('Content-Type', 'image/png').set('Accept', 'application/json').send(png);
  assert.equal(r2.status, 403);
  const r3 = await request(ctx.app).get(`/edicoes/${ed1}/imagens/1`).set('Accept', 'application/json');
  assert.equal(r3.status, 401);
});

test('PNG válido: 201 {id}; GET devolve os mesmos bytes com cabeçalhos seguros', async () => {
  const r = await enviar(edu, ed1, png);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(Number.isInteger(r.body.id) && r.body.id > 0);
  const g = await binario(edu.get(`/edicoes/${ed1}/imagens/${r.body.id}`));
  assert.equal(g.status, 200);
  assert.equal(g.headers['content-type'], 'image/png');
  assert.equal(g.headers['x-content-type-options'], 'nosniff');
  assert.equal(g.headers['cache-control'], 'private, max-age=3600');
  assert.ok(g.body.equals(png));
});

test('JPEG e WebP válidos são aceitos com o tipo detectado', async () => {
  const a = await enviar(edu, ed1, jpg, 'image/jpeg');
  assert.equal(a.status, 201);
  const b = await enviar(edu, ed1, webp, 'image/webp');
  assert.equal(b.status, 201);
  assert.equal((await edu.get(`/edicoes/${ed1}/imagens/${a.body.id}`)).headers['content-type'], 'image/jpeg');
  assert.equal((await edu.get(`/edicoes/${ed1}/imagens/${b.body.id}`)).headers['content-type'], 'image/webp');
});

test('SVG, GIF e texto são recusados com 415, mesmo com Content-Type image/png', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await enviar(edu, ed1, svg, 'image/png')).status, 415);
  assert.equal((await enviar(edu, ed1, svg, 'image/svg+xml')).status, 415);
  assert.equal((await enviar(edu, ed1, Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/png')).status, 415);
  assert.equal((await enviar(edu, ed1, Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/gif')).status, 415);
  assert.equal((await enviar(edu, ed1, 'só texto', 'image/png')).status, 415);
  assert.equal((await enviar(edu, ed1, 'só texto', 'text/plain')).status, 415);
  assert.equal((await enviar(edu, ed1, Buffer.alloc(0), 'image/png')).status, 415);
});

test('o mime guardado vem da assinatura, não do cabeçalho', async () => {
  const r = await enviar(edu, ed1, png, 'image/jpeg');
  assert.equal(r.status, 201);
  const g = await edu.get(`/edicoes/${ed1}/imagens/${r.body.id}`);
  assert.equal(g.headers['content-type'], 'image/png');
});

test('acima de 2 MB: 413', async () => {
  const grande = Buffer.concat([PNG_SIG, Buffer.alloc(2 * 1024 * 1024 + 10, 1)]);
  assert.equal((await enviar(edu, ed1, grande)).status, 413);
});

test('edição inexistente ou id malformado: 404', async () => {
  assert.equal((await enviar(edu, 99999, png)).status, 404);
  assert.equal((await enviar(edu, 'abc', png)).status, 404);
});

test('GET de imagem de outra edição ou inexistente: 404', async () => {
  const r = await enviar(edu, ed1, png);
  assert.equal((await edu.get(`/edicoes/${ed2}/imagens/${r.body.id}`)).status, 404);
  assert.equal((await edu.get(`/edicoes/${ed1}/imagens/999999`)).status, 404);
  assert.equal((await edu.get(`/edicoes/${ed1}/imagens/abc`)).status, 404);
});

test('edição publicada: 409 no envio; a leitura continua funcionando', async () => {
  const id = await ctx.app.locals.editions.createEdition({ numero: 3, mesAno: '2026-10', titulo: 'E3' }, ctx.ids.edu);
  const r = await enviar(ana, id, png);
  assert.equal(r.status, 201);
  await ctx.app.locals.editions.setStatus(id, 'publicada', ctx.ids.edu);
  assert.equal((await enviar(ana, id, png)).status, 409);
  assert.equal((await ana.get(`/edicoes/${id}/imagens/${r.body.id}`)).status, 200);
});

test('limite de 30 imagens por edição: 409 na 31a', async () => {
  const id = await ctx.app.locals.editions.createEdition({ numero: 4, mesAno: '2026-10', titulo: 'E4' }, ctx.ids.edu);
  for (let i = 0; i < 30; i++) {
    await ctx.pool.query("INSERT INTO imagens (edicao_id, mime, conteudo) VALUES (?, 'image/png', ?)", [id, png]);
  }
  const r = await enviar(edu, id, png);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /30/);
});
