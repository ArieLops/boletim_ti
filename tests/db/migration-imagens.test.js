process.env.BOLETIM_TEST_DB = 'boletim_test_mig_imagens';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { migrate } = require('../../src/db/migrate');

const colunas = async (pool) => (await pool.query(
  "SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imagens' ORDER BY ORDINAL_POSITION"
))[0];

test('003 cria a tabela imagens com as colunas esperadas', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  const c = await colunas(pool);
  assert.deepEqual(c.map((x) => x.COLUMN_NAME), ['id', 'edicao_id', 'mime', 'conteudo', 'criado_em']);
  assert.equal(c.find((x) => x.COLUMN_NAME === 'conteudo').DATA_TYPE, 'longblob');
});

test('003 é idempotente: reaplicar sem registro não falha nem perde dados', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  await pool.query("INSERT INTO edicoes (numero, mes_ano, titulo) VALUES (1, '2026-10', 'x')");
  await pool.query("INSERT INTO imagens (edicao_id, mime, conteudo) VALUES (1, 'image/png', ?)", [Buffer.from('a')]);
  await pool.query('DELETE FROM schema_migrations WHERE nome = ?', ['003_imagens.sql']);
  assert.deepEqual(await migrate(pool), ['003_imagens.sql']);
  assert.deepEqual(await migrate(pool), []);
  const [r] = await pool.query('SELECT COUNT(*) AS n FROM imagens');
  assert.equal(Number(r[0].n), 1);
});

test('apagar a edição apaga as imagens (ON DELETE CASCADE)', async (t) => {
  const pool = await resetTestDb();
  t.after(() => pool.end());
  await pool.query("INSERT INTO edicoes (numero, mes_ano, titulo) VALUES (1, '2026-10', 'x')");
  await pool.query("INSERT INTO imagens (edicao_id, mime, conteudo) VALUES (1, 'image/png', ?)", [Buffer.from('a')]);
  await pool.query('DELETE FROM edicoes WHERE id = 1');
  const [r] = await pool.query('SELECT COUNT(*) AS n FROM imagens');
  assert.equal(Number(r[0].n), 0);
});
