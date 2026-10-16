// urlComBase: função pura de src/public/api.js que prefixa caminhos da aplicação com o BASE_PATH.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { urlComBase } = require('../../src/public/api');

test('modo raiz: caminho inalterado', () => {
  assert.equal(urlComBase('', '/x'), '/x');
  assert.equal(urlComBase('', '/'), '/');
  assert.equal(urlComBase('', '/edicoes/1?a=b#c'), '/edicoes/1?a=b#c');
});

test('modo prefixado: prefixa o caminho', () => {
  assert.equal(urlComBase('/boletim_ti', '/edicoes/1'), '/boletim_ti/edicoes/1');
  assert.equal(urlComBase('/boletim_ti', '/'), '/boletim_ti/');
  assert.equal(urlComBase('/a/b', '/login'), '/a/b/login');
});

test('preserva query string e hash', () => {
  assert.equal(urlComBase('/boletim_ti', '/api/configuracoes/logo?t=1'), '/boletim_ti/api/configuracoes/logo?t=1');
  assert.equal(urlComBase('/boletim_ti', '/edicoes/2/download/pdf?confirmar=1#x'), '/boletim_ti/edicoes/2/download/pdf?confirmar=1#x');
});

test('rejeita caminho sem "/" inicial, com "//" inicial ou que não é string', () => {
  for (const p of ['x', 'edicoes/1', '', '//evil.com/x', 'http://evil.com/x', 'https://evil.com', undefined, null, 5]) {
    assert.throws(() => urlComBase('/boletim_ti', p), /caminho/i, String(p));
    assert.throws(() => urlComBase('', p), /caminho/i, String(p));
  }
});

test('não prefixa duas vezes um caminho que já começa com a base + "/"', () => {
  assert.equal(urlComBase('/boletim_ti', '/boletim_ti/edicoes/1'), '/boletim_ti/edicoes/1');
  assert.equal(urlComBase('/boletim_ti', '/boletim_ti'), '/boletim_ti');
  assert.equal(urlComBase('/boletim_ti', '/boletim_ti?a=1'), '/boletim_ti?a=1');
  // idempotente: aplicar de novo não muda
  const uma = urlComBase('/boletim_ti', '/login');
  assert.equal(urlComBase('/boletim_ti', uma), uma);
});

test('prefixo apenas parecido (sem "/" depois) ainda é prefixado', () => {
  assert.equal(urlComBase('/boletim_ti', '/boletim_tiXYZ/a'), '/boletim_ti/boletim_tiXYZ/a');
});
