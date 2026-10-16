const test = require('node:test');
const assert = require('node:assert');
const { renderEdition } = require('../../src/render/renderEdition');

const edicao = { numero: 1, mes_ano: '2026-10', titulo: 'Informações da TI', subtitulo: 'Avisos rápidos' };
const card = (n) => ({ id: n, tipo: 'card', ordem: n, dados: { etiqueta: 'E' + n, titulo: 'T' + n, texto: 'X' + n } });

test('escapa HTML em textos do usuario', () => {
  const html = renderEdition({ edicao: { ...edicao, titulo: '<script>alert(1)</script>' }, blocos: [] });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
});

test('3 cards seguidos formam uma grade com ultimo-impar', () => {
  const html = renderEdition({ edicao, blocos: [card(1), card(2), card(3)] });
  assert.strictEqual((html.match(/class="grade-cards"/g) || []).length, 1);
  assert.strictEqual((html.match(/<article class="bloco bloco-card/g) || []).length, 3);
  assert.strictEqual((html.match(/<article class="bloco bloco-card ultimo-impar/g) || []).length, 1);
  assert.ok(/bloco-card ultimo-impar[\s\S]*T3/.test(html));
});

test('linha de edicao com numero de 3 digitos e mes por extenso', () => {
  const html = renderEdition({ edicao, blocos: [] });
  assert.ok(html.includes('EDIÇÃO 001 · OUTUBRO/2026'));
});

test('sem blocos: cabecalho e rodape; "Edição vazia" so no preview', () => {
  const html = renderEdition({ edicao, blocos: [] });
  assert.ok(html.includes('TI SENAR-RS'));
  assert.ok(html.includes('informatica@senar-rs.com.br'));
  assert.ok(html.includes('Comunicado semanal'));
  assert.ok(!html.includes('Edição vazia'));
  assert.ok(renderEdition({ edicao, blocos: [], preview: true }).includes('Edição vazia'));
});

test('scale vira --escala', () => {
  assert.ok(renderEdition({ edicao, blocos: [], scale: 0.8 }).includes('--escala:0.8'));
  assert.ok(renderEdition({ edicao, blocos: [] }).includes('--escala:1'));
});

test('quebra de linha vira <br>', () => {
  const html = renderEdition({ edicao, blocos: [{ id: 1, tipo: 'texto', ordem: 1, dados: { titulo: 'A', texto: 'linha1\nlinha2' } }] });
  assert.ok(html.includes('linha1<br>linha2'));
});

test('modos a4 e strip, paleta customizada e rodape', () => {
  const a4 = renderEdition({ edicao, blocos: [], mode: 'a4' });
  assert.ok(a4.includes('210mm') && a4.includes('297mm') && a4.includes('id="conteudo"'));
  assert.ok(renderEdition({ edicao, blocos: [], mode: 'strip' }).includes('1080px'));
  const c = renderEdition({ edicao, blocos: [], settings: { cores: { '--verde-escuro': '#123456' }, rodape: 'X<b>', emailTi: 'a@b.c' } });
  assert.ok(c.includes('--verde-escuro:#123456'));
  assert.ok(c.includes('X&lt;b&gt;') && c.includes('a@b.c'));
});
