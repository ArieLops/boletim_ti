process.env.BOLETIM_TEST_DB = 'boletim_test_images';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { makeImagesRepo } = require('../../src/repos/images');
const { makeEditionsRepo } = require('../../src/repos/editions');

let pool, img, ed, e1, e2, uid;
before(async () => {
  pool = await resetTestDb();
  img = makeImagesRepo(pool);
  ed = makeEditionsRepo(pool);
  await pool.query("INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES ('A', 'a', 'x', 'editor')");
  uid = (await pool.query('SELECT id FROM usuarios'))[0][0].id;
  e1 = await ed.createEdition({ numero: 1, mesAno: '2026-10', titulo: 'E1' }, uid);
  e2 = await ed.createEdition({ numero: 2, mesAno: '2026-10', titulo: 'E2' }, uid);
});
after(() => pool.end());

const buf = (n) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8, n)]);

test('saveImage devolve id; getImage devolve mime e bytes; outra edição = null', async () => {
  const id = await img.saveImage(e1, { mime: 'image/png', buffer: buf(1) });
  assert.ok(Number.isInteger(id) && id > 0);
  const r = await img.getImage(e1, id);
  assert.equal(r.mime, 'image/png');
  assert.ok(Buffer.isBuffer(r.buffer));
  assert.ok(r.buffer.equals(buf(1)));
  assert.equal(await img.getImage(e2, id), null);
  assert.equal(await img.getImage(e1, 999999), null);
});

test('getMany devolve só as imagens da edição pedida', async () => {
  const a = await img.saveImage(e1, { mime: 'image/png', buffer: buf(2) });
  const b = await img.saveImage(e2, { mime: 'image/jpeg', buffer: buf(3) });
  const r = await img.getMany(e1, [a, b]);
  assert.deepEqual(Object.keys(r), [String(a)]);
  assert.ok(r[a].buffer.equals(buf(2)));
  assert.deepEqual(await img.getMany(e1, []), {});
});

test('countByEdition conta por edição', async () => {
  const antes = await img.countByEdition(e2);
  await img.saveImage(e2, { mime: 'image/png', buffer: buf(4) });
  assert.equal(await img.countByEdition(e2), antes + 1);
  assert.equal(await img.countByEdition(999999), 0);
});
