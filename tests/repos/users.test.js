process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_users'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { makeUsersRepo } = require('../../src/repos/users');
const { hashPassword, checkPassword } = require('../../src/auth/passwords');

let pool;
let users;
before(async () => {
  pool = await resetTestDb();
  users = makeUsersRepo(pool);
});
after(async () => {
  await pool.end();
});

test('hashPassword gera hash diferente da senha e checkPassword confere', async () => {
  const h = await hashPassword('segredo123');
  assert.notEqual(h, 'segredo123');
  assert.equal(await checkPassword('segredo123', h), true);
  assert.equal(await checkPassword('outra', h), false);
});

test('createUser + verifyLogin correto retorna usuário (trocar_senha=1)', async () => {
  const id = await users.createUser({ nome: 'Ana', login: 'ana', senha: 'senha-ana-1', perfil: 'editor' });
  assert.equal(typeof id, 'number');
  const u = await users.verifyLogin('ana', 'senha-ana-1');
  assert.equal(u.id, id);
  assert.equal(u.perfil, 'editor');
  assert.equal(u.trocar_senha, 1);
  assert.notEqual(u.senha_hash, 'senha-ana-1');
});

test('verifyLogin com senha errada ou login inexistente retorna null', async () => {
  assert.equal(await users.verifyLogin('ana', 'errada'), null);
  assert.equal(await users.verifyLogin('ninguem', 'x'), null);
});

test('usuário inativo não faz login; reativar volta a permitir', async () => {
  const id = await users.createUser({ nome: 'Bia', login: 'bia', senha: 'senha-bia-1', perfil: 'editor' });
  await users.setActive(id, false);
  assert.equal(await users.verifyLogin('bia', 'senha-bia-1'), null);
  await users.setActive(id, true);
  assert.ok(await users.verifyLogin('bia', 'senha-bia-1'));
});

test('login duplicado é rejeitado', async () => {
  await assert.rejects(
    users.createUser({ nome: 'Ana 2', login: 'ana', senha: 'senha-ana-2', perfil: 'editor' }),
    (e) => e.code === 'ER_DUP_ENTRY'
  );
});

test('setPassword troca a senha e zera trocar_senha', async () => {
  const id = await users.createUser({ nome: 'Caio', login: 'caio', senha: 'senha-caio-1', perfil: 'administrador' });
  await users.setPassword(id, 'nova-senha-caio');
  assert.equal(await users.verifyLogin('caio', 'senha-caio-1'), null);
  const u = await users.verifyLogin('caio', 'nova-senha-caio');
  assert.equal(u.trocar_senha, 0);
});

test('listUsers não expõe senha_hash', async () => {
  const lista = await users.listUsers();
  assert.ok(lista.length >= 3);
  assert.ok(lista.every((u) => !('senha_hash' in u)));
});

test('hash descartável usa o mesmo custo bcrypt dos hashes reais', async () => {
  const { dummyHash } = require('../../src/auth/passwords');
  const anterior = process.env.BCRYPT_COST;
  try {
    for (const c of ['4', '5']) {
      process.env.BCRYPT_COST = c;
      const real = await hashPassword('x');
      const dummy = await dummyHash();
      const custo = (h) => Number(/^\$2[aby]\$(\d{2})\$/.exec(h)[1]);
      assert.equal(custo(dummy), custo(real));
      assert.equal(custo(dummy), Number(c));
    }
  } finally {
    process.env.BCRYPT_COST = anterior;
  }
});
