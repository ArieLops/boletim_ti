process.env.BOLETIM_TEST_DB = 'boletim_test_mig_link';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { migrate } = require('../../src/db/migrate');

const colunas = async (pool) => (await pool.query(
  "SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edicoes' AND COLUMN_NAME = 'token_publico'"
))[0];
const indices = async (pool) => (await pool.query(
  "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edicoes' AND INDEX_NAME = 'uq_edicoes_token_publico'"
))[0];

test('migrate aplica 001 e 002; segunda chamada não faz nada', async (t) => {
  const pool = await resetTestDb({ migrate: false });
  t.after(() => pool.end());
  assert.deepEqual(await migrate(pool), ['001_init.sql', '002_link_publico.sql']);
  assert.deepEqual(await migrate(pool), []);
});

test('002 cria token_publico (varchar(32) NULL) e índice único', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  const c = await colunas(pool);
  assert.equal(c.length, 1);
  assert.equal(c[0].IS_NULLABLE, 'YES');
  assert.equal(c[0].COLUMN_TYPE, 'varchar(32)');
  const i = await indices(pool);
  assert.equal(i.length, 1);
  assert.equal(Number(i[0].NON_UNIQUE), 0);
  assert.equal(i[0].COLUMN_NAME, 'token_publico');
});

test('002 é idempotente: reaplicar sem registro não falha nem duplica', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  await pool.query('DELETE FROM schema_migrations WHERE nome = ?', ['002_link_publico.sql']);
  assert.deepEqual(await migrate(pool), ['002_link_publico.sql']);
  assert.deepEqual(await migrate(pool), []);
  assert.equal((await colunas(pool)).length, 1);
  assert.equal((await indices(pool)).length, 1);
});

test('002 recompõe só o índice se a coluna já existir (falha parcial)', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  await pool.query('ALTER TABLE edicoes DROP INDEX uq_edicoes_token_publico');
  await pool.query('DELETE FROM schema_migrations WHERE nome = ?', ['002_link_publico.sql']);
  assert.deepEqual(await migrate(pool), ['002_link_publico.sql']);
  assert.equal((await indices(pool)).length, 1);
});

test('token_publico: duplicado falha (ER_DUP_ENTRY) e vários NULL são aceitos', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  const ins = (n, tok) => pool.query("INSERT INTO edicoes (numero, mes_ano, titulo, token_publico) VALUES (?, '2026-10', 'x', ?)", [n, tok]);
  await ins(1, null);
  await ins(2, null);
  await ins(3, 'abc');
  await assert.rejects(ins(4, 'abc'), (e) => e.code === 'ER_DUP_ENTRY');
});
