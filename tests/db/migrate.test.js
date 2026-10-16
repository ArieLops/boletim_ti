const test = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { migrate } = require('../../src/db/migrate');

const TABELAS = [
  'arquivos_publicados', 'blocos', 'configuracoes', 'edicoes',
  'historico', 'logo', 'schema_migrations', 'usuarios',
];

test('migrate aplica 001_init uma única vez e cria as 8 tabelas', async (t) => {
  const pool = await resetTestDb({ migrate: false });
  t.after(() => pool.end());

  assert.deepEqual(await migrate(pool), ['001_init.sql']);
  assert.deepEqual(await migrate(pool), []);

  const [rows] = await pool.query('SHOW TABLES');
  const nomes = rows.map((r) => Object.values(r)[0]).sort();
  assert.deepEqual(nomes, TABELAS);
});
