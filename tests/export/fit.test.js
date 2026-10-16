const test = require('node:test');
const assert = require('node:assert/strict');
const { pickScale } = require('../../src/export/fit');

// medir simulado: altura (mm) proporcional a escala
const linear = (alturaCheia) => async (scale) => alturaCheia * scale;

test('cabe a 100%: scale 1, sem estouro', async () => {
  assert.deepEqual(await pickScale(linear(290)), { scale: 1, estouro: false, faltaMm: 0 });
});

test('cabe so a 0.85 (sem erro de ponto flutuante)', async () => {
  const testados = [];
  const medir = async (sc) => { testados.push(sc); return 340 * sc; }; // 340*0.85 = 289 <= 297; 0.90 -> 306
  const r = await pickScale(medir);
  assert.deepEqual(r, { scale: 0.85, estouro: false, faltaMm: 0 });
  assert.deepEqual(testados, [1, 0.95, 0.9, 0.85]);
});

test('nao cabe nem no piso: estouro com faltaMm positivo', async () => {
  const r = await pickScale(linear(500));
  assert.equal(r.scale, 0.75);
  assert.equal(r.estouro, true);
  assert.equal(r.faltaMm, 78); // 500*0.75 - 297
});

test('faltaMm arredondado a 1 casa', async () => {
  const r = await pickScale(async () => 300.04);
  assert.equal(r.faltaMm, 3);
  const r2 = await pickScale(async () => 300.26);
  assert.equal(r2.faltaMm, 3.3);
});

test('piso customizado 0.6 e respeitado e passo de 5%', async () => {
  const testados = [];
  const r = await pickScale(async (sc) => { testados.push(sc); return 1000; }, { piso: 0.6 });
  assert.equal(r.scale, 0.6);
  assert.equal(r.estouro, true);
  assert.deepEqual(testados, [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]);
});

test('alturaMm customizada', async () => {
  const r = await pickScale(linear(200), { alturaMm: 150 });
  assert.equal(r.scale, 0.75);
  assert.equal(r.estouro, false);
});

test('piso que nao e multiplo do passo (0.72) e o ultimo escala testada', async () => {
  const testados = [];
  const r = await pickScale(async (sc) => { testados.push(sc); return 1000; }, { piso: 0.72 });
  assert.equal(testados[testados.length - 1], 0.72);
  assert.deepEqual(testados, [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.72]);
  assert.deepEqual(r.scale, 0.72);
  assert.equal(r.estouro, true);
});
