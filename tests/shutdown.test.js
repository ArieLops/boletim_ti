const test = require('node:test');
const assert = require('node:assert/strict');
const { criarEncerramento } = require('../src/bootstrap');

// Dublês que registram a ordem das chamadas.
function montar({ closeDemora = null, timeoutMs = 1000 } = {}) {
  const ordem = [];
  const saidas = [];
  const server = {
    close(cb) {
      ordem.push('server.close:chamado');
      const fim = () => { ordem.push('server.close:concluido'); cb(); };
      if (closeDemora) closeDemora(fim);
      else setImmediate(fim);
    },
    closeIdleConnections() { ordem.push('server.closeIdle'); },
  };
  const app = { locals: { close: async () => { ordem.push('app.close'); } } };
  const exporter = { close: async () => { ordem.push('exporter.close'); } };
  const closePool = async () => { ordem.push('closePool'); };
  const encerrar = criarEncerramento({
    server, app, exporter, closePool, timeoutMs,
    exit: (c) => saidas.push(c),
    log: { log() {}, error() {} },
  });
  return { ordem, saidas, encerrar };
}

test('encerramento: espera o server.close terminar ANTES de fechar store, exportador e pool; sai com 0', async () => {
  const t = montar();
  await t.encerrar('SIGTERM');
  assert.deepEqual(t.ordem, [
    'server.close:chamado', 'server.closeIdle', 'server.close:concluido', 'app.close', 'exporter.close', 'closePool',
  ]);
  assert.deepEqual(t.saidas, [0]);
});

test('encerramento: requisição em andamento termina antes de qualquer recurso ser fechado', async () => {
  let terminarRequisicao;
  const t = montar({ closeDemora: (fim) => { terminarRequisicao = fim; } });
  const p = t.encerrar('SIGTERM');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!t.ordem.includes('app.close') && !t.ordem.includes('closePool'), 'não pode fechar recursos com requisição em curso');
  assert.deepEqual(t.saidas, []);
  terminarRequisicao();
  await p;
  assert.ok(t.ordem.indexOf('server.close:concluido') < t.ordem.indexOf('app.close'));
  assert.deepEqual(t.saidas, [0]);
});

test('encerramento: se a requisição nunca termina, o guarda força a saída com código 1', async () => {
  const t = montar({ closeDemora: () => {}, timeoutMs: 40 });
  const vivo = setInterval(() => {}, 1000); // o guarda é unref: mantém o laço de eventos vivo no teste
  try {
    await t.encerrar('SIGTERM');
  } finally {
    clearInterval(vivo);
  }
  assert.deepEqual(t.saidas, [1]);
  assert.ok(!t.ordem.includes('app.close'));
});

test('encerramento: segundo sinal não reentra', async () => {
  const t = montar();
  await Promise.all([t.encerrar('SIGTERM'), t.encerrar('SIGINT')]);
  await t.encerrar('SIGTERM');
  assert.equal(t.ordem.filter((x) => x === 'server.close:chamado').length, 1);
  assert.equal(t.ordem.filter((x) => x === 'closePool').length, 1);
  assert.deepEqual(t.saidas, [0]);
});

test('encerramento: falha ao fechar um recurso sai com código 1', async () => {
  const t = montar();
  const ordem = t.ordem;
  const encerrar = criarEncerramento({
    server: { close: (cb) => cb(), closeIdleConnections() {} },
    app: { locals: { close: async () => { throw new Error('boom'); } } },
    exporter: { close: async () => ordem.push('exporter.close') },
    closePool: async () => {},
    timeoutMs: 1000,
    exit: (c) => t.saidas.push(c),
    log: { log() {}, error() {} },
  });
  await encerrar('SIGTERM');
  assert.deepEqual(t.saidas, [1]);
});
