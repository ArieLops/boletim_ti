const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffBlocks } = require('../../src/domain/diff');

const b = (id, titulo, texto = 'x') => ({ id, tipo: 'texto', dados: { titulo, texto } });

test('sem mudanças não gera eventos', () => {
  assert.deepEqual(diffBlocks([b(1, 'A'), b(2, 'B')], [b(1, 'A'), b(2, 'B')]), []);
});

test('detecta criado (sem id ou id novo)', () => {
  const r = diffBlocks([b(1, 'A')], [b(1, 'A'), { tipo: 'texto', dados: { titulo: 'Novo', texto: 'x' } }]);
  assert.deepEqual(r, [{ acao: 'bloco_criado', blocoId: null, titulo: 'Novo' }]);
});

test('detecta alterado', () => {
  const r = diffBlocks([b(1, 'A')], [b(1, 'A', 'mudou')]);
  assert.deepEqual(r, [{ acao: 'bloco_alterado', blocoId: 1, titulo: 'A' }]);
});

test('detecta removido com o título anterior', () => {
  const r = diffBlocks([b(1, 'A'), b(2, 'B')], [b(1, 'A')]);
  assert.deepEqual(r, [{ acao: 'bloco_removido', blocoId: 2, titulo: 'B' }]);
});

test('detecta reordenado apenas o bloco movido', () => {
  const r = diffBlocks([b(1, 'A'), b(2, 'B'), b(3, 'C')], [b(2, 'B'), b(3, 'C'), b(1, 'A')]);
  assert.deepEqual(r, [{ acao: 'bloco_reordenado', blocoId: 1, titulo: 'A' }]);
});
