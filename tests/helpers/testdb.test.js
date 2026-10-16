const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDbName, resetTestDb } = require('./testdb');

test('guarda do banco de teste: só aceita nomes boletim_test* e nunca o DB_NAME da aplicação', () => {
  assert.doesNotThrow(() => assertSafeTestDbName('boletim_test', {}));
  assert.doesNotThrow(() => assertSafeTestDbName('boletim_test_rt_views', { DB_NAME: 'boletim' }));
  for (const ruim of ['boletim', 'mysql', 'information_schema', 'meu_boletim_test', '', undefined, 'Boletim_Test', 'boletim_test`; DROP']) {
    assert.throws(() => assertSafeTestDbName(ruim, {}), /BOLETIM_TEST_DB/, String(ruim));
  }
  assert.throws(() => assertSafeTestDbName('boletim_test_prod', { DB_NAME: 'boletim_test_prod' }), /DB_NAME/);
});

test('resetTestDb recusa nome inseguro antes de qualquer conexão', async () => {
  const anterior = process.env.BOLETIM_TEST_DB;
  process.env.BOLETIM_TEST_DB = 'boletim';
  try {
    await assert.rejects(resetTestDb(), /BOLETIM_TEST_DB/);
  } finally {
    if (anterior === undefined) delete process.env.BOLETIM_TEST_DB;
    else process.env.BOLETIM_TEST_DB = anterior;
  }
});
