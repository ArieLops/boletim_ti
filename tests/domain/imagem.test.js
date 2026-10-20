const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectarMime, MAX_BYTES, MAX_POR_EDICAO, MAX_BLOCOS_COM_IMAGEM } = require('../../src/domain/imagem');

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(10, 1)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 2)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(10)]);

test('constantes de limite', () => {
  assert.equal(MAX_BYTES, 1024 * 1024);
  assert.equal(MAX_POR_EDICAO, 60);
  assert.equal(MAX_BLOCOS_COM_IMAGEM, 30);
});

test('detectarMime reconhece PNG, JPEG e WebP pela assinatura', () => {
  assert.equal(detectarMime(png), 'image/png');
  assert.equal(detectarMime(jpg), 'image/jpeg');
  assert.equal(detectarMime(webp), 'image/webp');
});

test('detectarMime recusa SVG, GIF, vazio, texto e não-Buffer', () => {
  assert.equal(detectarMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectarMime(Buffer.from('<?xml version="1.0"?><svg/>')), null);
  assert.equal(detectarMime(Buffer.from('GIF89a......')), null);
  assert.equal(detectarMime(Buffer.alloc(0)), null);
  assert.equal(detectarMime(Buffer.from('olá mundo')), null);
  assert.equal(detectarMime(Buffer.from('RIFF1234WAVEfmt ')), null);
  assert.equal(detectarMime(Buffer.from('RIFF')), null);
  assert.equal(detectarMime('89504e470d0a1a0a'), null);
  assert.equal(detectarMime(undefined), null);
});
