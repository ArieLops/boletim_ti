process.env.BOLETIM_TEST_DB = 'boletim_test_server';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { resetTestDb } = require('./helpers/testdb');
const { loadConfig } = require('../src/config');
const { buildServer } = require('../src/bootstrap');
const { chromiumArgs } = require('../src/export/exporter');

const envBase = { SESSION_SECRET: 's', DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' };
const exporterFalso = { async close() {} };

test('config: HOST padrao 127.0.0.1 e configuravel', () => {
  assert.equal(loadConfig(envBase).host, '127.0.0.1');
  assert.equal(loadConfig({ ...envBase, HOST: '10.0.0.5' }).host, '10.0.0.5');
});

test('config: variavel obrigatoria ausente tem mensagem clara', () => {
  assert.throws(() => loadConfig({ ...envBase, DB_NAME: '' }), /faltou DB_NAME/);
});

test('/saude: 200 {ok:true} com banco no ar, sem sessao nem cookie', async () => {
  const pool = await resetTestDb();
  const srv = buildServer({ config: { cookieSecure: false, sessionSecret: 'x', sessionHours: 1 }, pool, exporter: exporterFalso });
  try {
    const res = await request(srv.app).get('/saude');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(res.headers['set-cookie'], undefined);
  } finally {
    await srv.close();
    await pool.end();
  }
});

test('/saude: 503 {ok:false} sem detalhes quando o banco falha', async () => {
  const pool = await resetTestDb();
  const quebrado = { query: async () => { throw new Error('senha do banco: segredo'); } };
  const srv = buildServer({ config: { cookieSecure: false, sessionSecret: 'x', sessionHours: 1 }, pool, exporter: exporterFalso });
  srv.app.locals.pool = quebrado;
  const logs = [];
  const original = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const res = await request(srv.app).get('/saude');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false });
    assert.ok(!JSON.stringify(res.body).includes('segredo'));
    assert.equal(logs.length, 1); // o erro vai para o log do serviço
  } finally {
    console.error = original;
    await srv.close();
    await pool.end();
  }
});

test('chromiumArgs: --no-sandbox so como root no Linux ou com CHROMIUM_NO_SANDBOX=1', () => {
  const sem = chromiumArgs({ platform: 'linux', uid: 1000, env: {} });
  assert.ok(!sem.includes('--no-sandbox'));
  assert.ok(chromiumArgs({ platform: 'linux', uid: 0, env: {} }).includes('--no-sandbox'));
  assert.ok(chromiumArgs({ platform: 'linux', uid: 1000, env: { CHROMIUM_NO_SANDBOX: '1' } }).includes('--no-sandbox'));
  assert.ok(chromiumArgs({ platform: 'win32', uid: undefined, env: { CHROMIUM_NO_SANDBOX: '1' } }).includes('--no-sandbox'));
  assert.ok(!chromiumArgs({ platform: 'win32', uid: undefined, env: {} }).includes('--no-sandbox'));
  assert.ok(!chromiumArgs({ platform: 'linux', uid: 1000, env: { CHROMIUM_NO_SANDBOX: '0' } }).includes('--no-sandbox'));
  assert.ok(sem.includes('--disable-gpu'));
});
