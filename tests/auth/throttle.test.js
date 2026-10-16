const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createThrottle } = require('../../src/auth/throttle');

test('5 falhas bloqueiam a chave', () => {
  const t = createThrottle();
  for (let i = 0; i < 4; i++) t.registrarFalha('a|1');
  assert.equal(t.bloqueado('a|1'), false);
  t.registrarFalha('a|1');
  assert.equal(t.bloqueado('a|1'), true);
  assert.equal(t.bloqueado('b|1'), false);
});

test('após a janela o bloqueio expira', () => {
  let agora = 1000;
  const t = createThrottle({ janelaMs: 60000, agora: () => agora });
  for (let i = 0; i < 5; i++) t.registrarFalha('k');
  assert.equal(t.bloqueado('k'), true);
  agora += 60001;
  assert.equal(t.bloqueado('k'), false);
});

test('limpar zera as falhas', () => {
  const t = createThrottle();
  for (let i = 0; i < 5; i++) t.registrarFalha('k');
  t.limpar('k');
  assert.equal(t.bloqueado('k'), false);
});
