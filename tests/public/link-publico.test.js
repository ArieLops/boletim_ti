const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../src/public/editor-lib');

const TOKEN = 'abcdefghijklmnopqrstuv';

test('urlPublica: origem + base + /p/<token>', () => {
  assert.equal(lib.urlPublica('http://192.168.10.161', '/boletim_ti', TOKEN), `http://192.168.10.161/boletim_ti/p/${TOKEN}`);
  assert.equal(lib.urlPublica('http://localhost:3100', '', TOKEN), `http://localhost:3100/p/${TOKEN}`);
  assert.equal(lib.urlPublica('http://localhost:3100/', '', TOKEN), `http://localhost:3100/p/${TOKEN}`);
  assert.equal(lib.urlPublica('http://x.test/', '/boletim_ti', TOKEN), `http://x.test/boletim_ti/p/${TOKEN}`);
});

test('urlPublica: token inválido lança', () => {
  for (const t of ['', 'curto', TOKEN + 'x', TOKEN.slice(0, 21) + '/', TOKEN + '\n', null, undefined, 42]) {
    assert.throws(() => lib.urlPublica('http://x.test', '', t), TypeError, String(t));
  }
});

test('rotuloEstadoLink: publicada, em revisão e sem token', () => {
  assert.match(lib.rotuloEstadoLink('publicada', true), /Link público/);
  assert.doesNotMatch(lib.rotuloEstadoLink('publicada', true), /em revisão/);
  assert.match(lib.rotuloEstadoLink('rascunho', true), /em revisão/);
  assert.equal(lib.rotuloEstadoLink('publicada', false), '');
  assert.equal(lib.rotuloEstadoLink('rascunho', false), '');
});
