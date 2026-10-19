const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBasePath, makeUrl, relativePath } = require('../src/base-path');

test('normalizeBasePath: modo raiz', () => {
  for (const v of [undefined, '', '/', '  ', ' / ']) assert.equal(normalizeBasePath(v), '');
});

test('normalizeBasePath: valores válidos', () => {
  assert.equal(normalizeBasePath('/boletim_ti'), '/boletim_ti');
  assert.equal(normalizeBasePath('/boletim_ti/'), '/boletim_ti');
  assert.equal(normalizeBasePath(' /boletim_ti '), '/boletim_ti');
  assert.equal(normalizeBasePath('/a/b'), '/a/b');
});

test('normalizeBasePath: rejeita valores inseguros', () => {
  const ruins = ['//x', '/a//b', '/..', '/a/../b', '/.', 'http://x', '//evil.com', '/a?b', '/a#b', '/a\\b', '/a b', '/%2e%2e', 'boletim', '/á'];
  for (const v of ruins) {
    assert.throws(() => normalizeBasePath(v), /^Error: BASE_PATH inválido/, `deveria rejeitar ${JSON.stringify(v)}`);
  }
});

test('normalizeBasePath: rejeita primeiro segmento que colide com rotas da aplicação', () => {
  for (const v of ['/edicoes', '/api', '/login', '/saude', '/usuarios', '/logout', '/trocar-senha', '/configuracoes', '/api.js', '/app.css', '/edicoes/x', '/p', '/p/x']) {
    assert.throws(() => normalizeBasePath(v), /^Error: BASE_PATH inválido.*colide/, v);
  }
  for (const v of ['/edicoes2', '/boletim_ti', '/app', '/x/edicoes', '/apis', '/p2', '/x/p']) assert.equal(normalizeBasePath(v), v);
});

test('makeUrl', () => {
  const u = makeUrl('/boletim_ti');
  assert.equal(u('/login'), '/boletim_ti/login');
  assert.equal(u('/'), '/boletim_ti/');
  const raiz = makeUrl('');
  assert.equal(raiz('/login'), '/login');
  assert.equal(raiz('/'), '/');
  for (const p of ['login', '//x', '', undefined, 'http://x', '/\\host']) {
    assert.throws(() => u(p), /caminho/i);
    assert.throws(() => raiz(p), /caminho/i);
  }
});

test('relativePath', () => {
  assert.equal(relativePath('/boletim_ti', '/boletim_ti/api/x?y=1'), '/api/x?y=1');
  assert.equal(relativePath('/boletim_ti', '/boletim_ti'), '/');
  assert.equal(relativePath('/boletim_ti', '/boletim_ti?a=1'), '/?a=1');
  assert.equal(relativePath('', '/api/x'), '/api/x');
  assert.equal(relativePath('/boletim_ti', '/api/x'), '/api/x');
  assert.equal(relativePath('/boletim_ti', '/boletim_tiXYZ/api'), '/boletim_tiXYZ/api');
});
