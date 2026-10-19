const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'public', 'editor.js'), 'utf8');
const codigo = fonte.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('editor: nenhuma ação usa window.confirm do navegador (pode ser bloqueado em silêncio)', () => {
  assert.ok(!/\bconfirm\(/.test(codigo.replace(/perguntar\(/g, '')), 'use perguntar(), não window.confirm');
});

test('editor: publicar, reabrir, baixar, remover e trocar tipo pedem confirmação por perguntar()', () => {
  for (const rotulo of ["'Publicar'", "'Reabrir'", "'Baixar'", "'Remover'", "'Trocar'"]) {
    assert.ok(codigo.includes(rotulo), 'falta confirmação com o botão ' + rotulo);
  }
  assert.match(codigo, /function perguntar\(texto, rotuloOk\)/);
  assert.match(codigo, /showModal/);
});
