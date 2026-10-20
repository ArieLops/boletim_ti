const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../../src/public/editor-lib');

test('dimensoesReducao: lado maior limitado ao máximo, sem ampliar', () => {
  assert.deepEqual(lib.dimensoesReducao(4000, 3000, 800), { largura: 800, altura: 600 });
  assert.deepEqual(lib.dimensoesReducao(640, 480, 800), { largura: 640, altura: 480 });
  assert.deepEqual(lib.dimensoesReducao(600, 4800, 800), { largura: 100, altura: 800 });
  assert.deepEqual(lib.dimensoesReducao(800, 800, 800), { largura: 800, altura: 800 });
  assert.deepEqual(lib.dimensoesReducao(10000, 1, 800), { largura: 800, altura: 1 });
});

test('MAX_BLOCOS_COM_IMAGEM é 30 e vem do editor-lib', () => {
  assert.equal(lib.MAX_BLOCOS_COM_IMAGEM, 30);
});

test('tipoImagemPermitido: só png, jpeg e webp', () => {
  for (const m of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(lib.tipoImagemPermitido(m), true, m);
  for (const m of ['image/svg+xml', 'image/gif', '', undefined, null, 'text/html']) assert.equal(lib.tipoImagemPermitido(m), false, String(m));
});

test('trocarTipo ignora a chave imagem (ela acompanha o bloco, não é campo de texto)', () => {
  const r = lib.trocarTipo({ titulo: 'T', texto: 'X', etiqueta: '', imagem: 7 }, 'texto');
  assert.deepEqual(r.descartados, []);
  assert.deepEqual(r.dados, { titulo: 'T', texto: 'X' });
});

test('serializar mantém dados.imagem e validarLocal não exige imagem', () => {
  const p = lib.serializar({ versao: 1, campos: { titulo: 'T', mesAno: '2026-10' }, blocos: [{ id: 3, tipo: 'texto', dados: { titulo: 'a', texto: 'b', imagem: 12 } }] });
  assert.equal(p.blocos[0].dados.imagem, 12);
  assert.deepEqual(lib.validarLocal(p), []);
});

test('editor.js: tratamento da imagem (lerBloco, troca de tipo, erros por textContent, URL via Api.url)', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'public', 'editor.js'), 'utf8');
  assert.match(fonte, /dataset\.imagem/);
  assert.match(fonte, /remover-imagem/);
  assert.match(fonte, /Api\.url\('\/edicoes\/' \+ ID \+ '\/imagens/);
  assert.doesNotMatch(fonte, /innerHTML/);
  assert.match(fonte, /L\.MAX_BLOCOS_COM_IMAGEM/);
  assert.match(fonte, /LADO_MAXIMO_IMAGEM = 800/);
  assert.match(fonte, /A imagem não foi anexada porque o bloco mudou durante o envio\./);
  assert.doesNotMatch(fonte.match(/function mensagemImagem[^}]*}/)[0], /anunciar/);
});
