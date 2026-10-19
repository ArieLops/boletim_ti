const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../src/public/editor-lib');

test('texto -> dica mantém titulo e texto, sem descartes nem faltas', () => {
  const r = lib.trocarTipo({ titulo: 'T', texto: 'X' }, 'dica');
  assert.deepEqual(r, { dados: { titulo: 'T', texto: 'X' }, descartados: [], faltando: [] });
});

test('destaque -> dica descarta etiqueta e chamada preenchidas e mantém titulo/texto', () => {
  const r = lib.trocarTipo({ etiqueta: 'E', titulo: 'T', texto: 'X', chamada: 'C' }, 'dica');
  assert.deepEqual(r.dados, { titulo: 'T', texto: 'X' });
  assert.deepEqual(r.descartados, ['etiqueta', 'chamada']);
  assert.deepEqual(r.faltando, []);
});

test('destaque -> dica não lista descartados vazios nem só com espaços', () => {
  const r = lib.trocarTipo({ etiqueta: '', titulo: 'T', texto: 'X', chamada: '   ' }, 'dica');
  assert.deepEqual(r.descartados, []);
  const r2 = lib.trocarTipo({ etiqueta: '', titulo: 'T', texto: 'X', chamada: 'C' }, 'dica');
  assert.deepEqual(r2.descartados, ['chamada']);
});

test('dica -> destaque lista etiqueta e chamada como faltando', () => {
  const r = lib.trocarTipo({ titulo: 'T', texto: 'X' }, 'destaque');
  assert.deepEqual(r.dados, { etiqueta: '', titulo: 'T', texto: 'X', chamada: '' });
  assert.deepEqual(r.faltando, ['etiqueta', 'chamada']);
  assert.deepEqual(r.descartados, []);
});

test('mesmo tipo é identidade (nada descartado)', () => {
  const r = lib.trocarTipo({ etiqueta: 'E', titulo: 'T', texto: 'X' }, 'card');
  assert.deepEqual(r, { dados: { etiqueta: 'E', titulo: 'T', texto: 'X' }, descartados: [], faltando: [] });
});

test('card -> texto descarta etiqueta', () => {
  const r = lib.trocarTipo({ etiqueta: 'E', titulo: 'T', texto: 'X' }, 'texto');
  assert.deepEqual(r.dados, { titulo: 'T', texto: 'X' });
  assert.deepEqual(r.descartados, ['etiqueta']);
});

test('valor só com espaços conta como vazio em faltando', () => {
  const r = lib.trocarTipo({ titulo: '  ', texto: 'X' }, 'card');
  assert.deepEqual(r.faltando, ['etiqueta', 'titulo']);
  assert.equal(r.dados.titulo, '  ');
});

test('valores não string viram string; campos ausentes viram vazio', () => {
  const r = lib.trocarTipo({ titulo: 5 }, 'dica');
  assert.deepEqual(r.dados, { titulo: '5', texto: '' });
  assert.deepEqual(r.faltando, ['texto']);
});

test('tipo novo desconhecido lança RangeError', () => {
  assert.throws(() => lib.trocarTipo({ titulo: 'T' }, 'banner'), RangeError);
  assert.throws(() => lib.trocarTipo({}, undefined), RangeError);
});

test('listaCampos usa rótulos em português', () => {
  assert.equal(lib.listaCampos(['etiqueta', 'chamada']), 'Etiqueta, Linha de chamada');
  assert.deepEqual(lib.ROTULOS_CAMPO, { etiqueta: 'Etiqueta', titulo: 'Título', texto: 'Texto', chamada: 'Linha de chamada' });
});
