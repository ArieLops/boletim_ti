const { test } = require('node:test');
const assert = require('node:assert/strict');
const { novoToken, tokenValido } = require('../../src/domain/token');

test('novoToken: 22 caracteres base64url', () => {
  const t = novoToken();
  assert.equal(typeof t, 'string');
  assert.match(t, /^[A-Za-z0-9_-]{22}$/);
});

test('novoToken: 1000 tokens sem repetição', () => {
  const s = new Set();
  for (let i = 0; i < 1000; i++) s.add(novoToken());
  assert.equal(s.size, 1000);
});

test('tokenValido aceita token gerado', () => {
  for (let i = 0; i < 50; i++) assert.equal(tokenValido(novoToken()), true);
});

test('tokenValido rejeita entradas inválidas', () => {
  const ok = novoToken();
  const c21 = ok.slice(1);
  const ruins = ['', null, undefined, 123, {}, [], c21, ok + 'a', c21 + '+', c21 + '/', c21 + '=',
    c21 + ' ', c21 + '%', c21 + '.', ok + '\n', c21 + '\n', '\n' + c21];
  for (const v of ruins) assert.equal(tokenValido(v), false, JSON.stringify(v));
});
