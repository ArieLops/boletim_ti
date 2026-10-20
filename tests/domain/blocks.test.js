const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateBlock, TIPOS } = require('../../src/domain/blocks');

test('TIPOS lista os quatro tipos', () => {
  assert.deepEqual(TIPOS, ['destaque', 'card', 'dica', 'texto']);
});

test('card sem título é inválido', () => {
  const r = validateBlock('card', { etiqueta: 'E', texto: 'T' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('titulo')));
});

test('destaque completo é válido', () => {
  const r = validateBlock('destaque', { etiqueta: 'E', titulo: 'T', texto: 'X', chamada: 'C' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('tipo desconhecido gera erro', () => {
  const r = validateBlock('banner', { titulo: 'T' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('campo com 2001 caracteres é rejeitado; 2000 é aceito', () => {
  assert.equal(validateBlock('texto', { titulo: 'T', texto: 'a'.repeat(2001) }).ok, false);
  assert.equal(validateBlock('texto', { titulo: 'T', texto: 'a'.repeat(2000) }).ok, true);
});

test('espaços nas pontas são removidos', () => {
  const r = validateBlock('dica', { titulo: '  Oi  ', texto: ' x ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.dados, { titulo: 'Oi', texto: 'x' });
});

test('título só com espaços é inválido', () => {
  assert.equal(validateBlock('dica', { titulo: '   ', texto: 'x' }).ok, false);
});

test('imagem: inteiro positivo e preservado nos quatro tipos', () => {
  const base = { etiqueta: 'E', titulo: 'T', texto: 'X', chamada: 'C' };
  for (const tipo of TIPOS) {
    const r = validateBlock(tipo, { ...base, imagem: 7 });
    assert.equal(r.ok, true, tipo);
    assert.equal(r.dados.imagem, 7, tipo);
  }
});

test('imagem: valores invalidos sao descartados sem invalidar o bloco', () => {
  for (const v of ['x', '7', -1, 0, 1.5, null, true, NaN, Infinity, {}, []]) {
    const r = validateBlock('texto', { titulo: 'T', texto: 'X', imagem: v });
    assert.equal(r.ok, true);
    assert.equal('imagem' in r.dados, false, String(v));
  }
});

test('sem imagem, dados nao ganham a chave imagem', () => {
  const r = validateBlock('texto', { titulo: 'T', texto: 'X' });
  assert.deepEqual(r.dados, { titulo: 'T', texto: 'X' });
});
