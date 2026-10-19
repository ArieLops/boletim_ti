const test = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { migrate } = require('../../src/db/migrate');

const TABELAS = [
  'arquivos_publicados', 'blocos', 'configuracoes', 'edicoes',
  'historico', 'logo', 'schema_migrations', 'usuarios',
];

test('migrate aplica 001_init e 002 uma única vez e cria as 8 tabelas', async (t) => {
  const pool = await resetTestDb({ migrate: false });
  t.after(() => pool.end());

  assert.deepEqual(await migrate(pool), ['001_init.sql', '002_link_publico.sql']);
  assert.deepEqual(await migrate(pool), []);

  const [rows] = await pool.query('SHOW TABLES');
  const nomes = rows.map((r) => Object.values(r)[0]).sort();
  assert.deepEqual(nomes, TABELAS);
});

test('migrate é re-executável: reaplicar 001 sem registro não falha', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());

  await pool.query('DELETE FROM schema_migrations WHERE nome = ?', ['001_init.sql']);
  assert.deepEqual(await migrate(pool), ['001_init.sql']);
  assert.deepEqual(await migrate(pool), []);
});

test('duas execuções concorrentes de migrate não conflitam', async (t) => {
  const pool = await resetTestDb({ migrate: false });
  t.after(() => pool.end());

  const resultados = await Promise.all([migrate(pool), migrate(pool)]);
  const aplicadas = resultados.map((r) => r.length).sort();
  assert.deepEqual(aplicadas, [0, 2]);
});
