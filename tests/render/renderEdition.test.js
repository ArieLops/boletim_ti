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

test('cabecalho: simbolo do SENAR a esquerda (fixo) e logo conecta TI a direita', () => {
  const html = renderEdition({ edicao, blocos: [] });
  assert.ok(html.includes('class="logo-senar"'));
  assert.ok(html.includes('class="logo"'));
  assert.ok(html.indexOf('class="logo-senar"') < html.indexOf('class="logo"'));
});

test('sem blocos: cabecalho e rodape; "Edição vazia" so no preview', () => {
  const html = renderEdition({ edicao, blocos: [] });
  assert.ok(html.includes('TI SENAR-RS'));
  assert.ok(html.includes('informatica@senar-rs.com.br'));
  // O cabeçalho não tem mais as barras verdes nem o texto "Comunicado semanal" (a logo já o traz).
  assert.ok(!html.includes('class="barras"'));
  assert.ok(!html.includes('class="nome"'));
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
  assert.ok(a4.includes('@page{size:A4;margin:0}'));
  const c = renderEdition({ edicao, blocos: [], settings: { cores: { '--verde-escuro': '#123456' }, rodape: 'X<b>', emailTi: 'a@b.c' } });
  assert.ok(c.includes('--verde-escuro:#123456'));
  assert.ok(c.includes('X&lt;b&gt;') && c.includes('a@b.c'));
});

const bodyOf = (html) => html.slice(html.indexOf('</style>'));
const cards = (n) => Array.from({ length: n }, (_, i) => card(i + 1));
const HOSTIL = '&<b>x</b><script>alert(1)</script>';

test('todos os campos de todos os blocos e o subtitulo sao escapados', () => {
  const mk = (campos) => Object.fromEntries(campos.map((c) => [c, HOSTIL + c]));
  const blocos = [
    { id: 1, tipo: 'destaque', ordem: 1, dados: mk(['etiqueta', 'titulo', 'texto', 'chamada']) },
    { id: 2, tipo: 'card', ordem: 2, dados: mk(['etiqueta', 'titulo', 'texto']) },
    { id: 3, tipo: 'dica', ordem: 3, dados: mk(['titulo', 'texto']) },
    { id: 4, tipo: 'texto', ordem: 4, dados: mk(['titulo', 'texto']) },
  ];
  const b = bodyOf(renderEdition({ edicao: { ...edicao, subtitulo: HOSTIL + 'sub' }, blocos }));
  assert.ok(!b.includes('<script>') && !b.includes('<b>x'));
  for (const c of ['etiqueta', 'titulo', 'texto', 'chamada', 'sub']) {
    assert.ok(b.includes(`&amp;&lt;b&gt;x&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;${c}`), c);
  }
});

test('ultimo-impar: pares nao marcam, impares marcam so o ultimo', () => {
  const count = (n) => (renderEdition({ edicao, blocos: cards(n) }).match(/<article class="bloco bloco-card ultimo-impar/g) || []).length;
  assert.strictEqual(count(2), 0);
  assert.strictEqual(count(4), 0);
  assert.strictEqual(count(1), 1);
  assert.strictEqual(count(3), 1);
  assert.ok(/bloco-card ultimo-impar"><span class="etiqueta">E1/.test(renderEdition({ edicao, blocos: cards(1) })));
  assert.ok(!/ultimo-impar"><span class="etiqueta">E[12]</.test(renderEdition({ edicao, blocos: cards(3) })));
});

test('tipo desconhecido nao quebra e nao gera marcacao', () => {
  const html = renderEdition({ edicao, blocos: [{ id: 1, tipo: 'xyz', ordem: 1, dados: { titulo: 'SEGREDO' } }] });
  assert.ok(!html.includes('SEGREDO'));
  assert.ok(!bodyOf(html).includes('class="bloco'));
});

test('mes_ano e numero malformados nao lancam', () => {
  for (const mes_ano of [null, undefined, '2026-13', 'abc']) {
    assert.doesNotThrow(() => renderEdition({ edicao: { ...edicao, mes_ano }, blocos: [] }));
  }
  assert.ok(renderEdition({ edicao: { ...edicao, mes_ano: '2026-13' }, blocos: [] }).includes('2026-13'));
  for (const numero of [undefined, null, 1.5, 'x', NaN]) {
    assert.doesNotThrow(() => renderEdition({ edicao: { ...edicao, numero }, blocos: [] }));
  }
});

test('settings.cores malicioso e ignorado', () => {
  const html = renderEdition({
    edicao,
    blocos: [],
    settings: { cores: { '--a': 'red</style><script>x()</script>', '--b;{}': '#fff', '--c': 'red;}body{display:none', '--teal': '#111111' } },
  });
  assert.strictEqual((html.match(/<\/style>/g) || []).length, 1);
  assert.ok(!html.includes('--a:') && !html.includes('--b;') && !html.includes('--c:') && !html.includes('display:none'));
  assert.ok(html.includes('--teal:#111111'));
});

test('palavra gigante: regra overflow-wrap cobre etiqueta e chamada', () => {
  const g = 'W'.repeat(60);
  const html = renderEdition({
    edicao,
    blocos: [
      { id: 1, tipo: 'destaque', ordem: 1, dados: { etiqueta: g, titulo: g, texto: g, chamada: g } },
      { id: 2, tipo: 'card', ordem: 2, dados: { etiqueta: g, titulo: g, texto: g } },
    ],
  });
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const regra = /([^{}]*)\{[^}]*overflow-wrap:anywhere[^}]*\}/.exec(css)[1];
  assert.ok(regra.includes('.etiqueta') && regra.includes('.chamada') && regra.includes('.texto'));
  assert.ok(/\.etiqueta\{[^}]*max-width:100%/.test(css));
  assert.ok(bodyOf(html).includes('<article class="bloco bloco-card ultimo-impar"><span class="etiqueta">' + g));
});

test('pilha de fontes: Inter primeiro e fontes de emoji coloridas como reserva', () => {
  const html = renderEdition({ edicao, blocos: [] });
  const m = /body\{font-family:([^;]+);/.exec(html);
  assert.ok(m, 'regra de font-family do body');
  assert.ok(m[1].startsWith('Inter,'));
  assert.ok(m[1].endsWith('"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji"'), m[1]);
});

// ---- modo web (pagina publica /p/<token>) ----
const BARRA = '<nav class="barra-publica"><a href="/x/y">Baixar</a></nav>';
const webHtml = (extra = {}) => renderEdition({ edicao, blocos: cards(3), mode: 'web', ...extra });

test('web: documento fluido, sem caixa A4 fixa nem overflow oculto na pagina', () => {
  const html = webHtml();
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(!css.includes('297mm') && !css.includes('210mm') && !css.includes('@page'));
  assert.ok(!css.includes('1080px'));
  assert.match(css, /\.pagina\{[^}]*max-width:960px/);
  assert.match(css, /\.pagina\{[^}]*margin:0 auto/);
  assert.ok(!/\.pagina\{[^}]*overflow:hidden/.test(css));
  assert.ok(!/#conteudo\{[^}]*overflow:hidden/.test(css));
});

test('web: regra de coluna unica e cabecalho reduzido em tela estreita', () => {
  const css = webHtml();
  assert.match(css, /@media \(max-width:\s*640px\)\{[^@]*\.grade-cards\{grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:\s*640px\)\{[^@]*\.cabecalho\{--escala:/);
});

test('web: mesma marcacao do comunicado e escape em todos os campos', () => {
  const ruim = { etiqueta: HOSTIL, titulo: HOSTIL, texto: HOSTIL, chamada: HOSTIL };
  const html = renderEdition({
    edicao: { ...edicao, titulo: HOSTIL, subtitulo: HOSTIL },
    blocos: [{ tipo: 'destaque', dados: ruim }, { tipo: 'card', dados: ruim }, { tipo: 'dica', dados: ruim }, { tipo: 'texto', dados: ruim }],
    mode: 'web',
    barraHtml: BARRA,
  });
  const corpo = bodyOf(html);
  assert.ok(!corpo.includes('<script>alert') && !corpo.includes('<b>x</b>'));
  assert.ok(html.includes('class="cabecalho"') && html.includes('class="rodape"'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(html, /<title>&amp;&lt;b&gt;x/);
});

test('web: barraHtml entra logo apos <body>; nos modos a4 e strip e ignorado', () => {
  assert.ok(webHtml({ barraHtml: BARRA }).includes(`<body>${BARRA}`));
  assert.ok(!webHtml().includes('barra-publica"'));
  for (const mode of ['a4', 'strip']) {
    const html = renderEdition({ edicao, blocos: cards(2), mode, barraHtml: BARRA });
    assert.ok(!html.includes(BARRA), mode);
    assert.equal(html, renderEdition({ edicao, blocos: cards(2), mode }), mode);
  }
});

test('web: a barra tem estilo proprio com foco visivel e --escala continua valido', () => {
  const css = webHtml({ barraHtml: BARRA });
  assert.match(css, /\.barra-publica a:focus-visible\{outline:/);
  assert.ok(css.includes(':root{--escala:1;'));
  assert.ok(renderEdition({ edicao, blocos: [], mode: 'web', scale: 0.8 }).includes('--escala:0.8;'));
});

// ---- imagem opcional nos blocos ----
const { buildCss } = require('../../src/render/styles');
const PNG_B = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('imagem-de-teste-unica')]);
const B64 = PNG_B.toString('base64');
const mapa = { 7: { mime: 'image/png', buffer: PNG_B } };
const comImg = (b) => ({ ...b, dados: { ...b.dados, imagem: 7 } });
const todosTipos = [
  { id: 1, tipo: 'destaque', ordem: 1, dados: { etiqueta: 'D', titulo: 'TD', texto: 'XD', chamada: 'CD' } },
  { id: 2, tipo: 'card', ordem: 2, dados: { etiqueta: 'C', titulo: 'TC', texto: 'XC' } },
  { id: 3, tipo: 'dica', ordem: 3, dados: { titulo: 'TI', texto: 'XI' } },
  { id: 4, tipo: 'texto', ordem: 4, dados: { titulo: 'TT', texto: 'XT' } },
];

test('imagem: cada tipo de bloco leva a figura como primeiro filho, antes do texto', () => {
  for (const b of todosTipos) {
    const html = renderEdition({ edicao, blocos: [comImg(b)], imagens: mapa });
    const fig = '<figure class="img-bloco"><img src="data:image/png;base64,' + B64 + '" alt=""></figure>';
    assert.ok(html.includes(fig), b.tipo);
    const re = /<(section|article) class="bloco [^"]*">(.*?)<\/(section|article)>/s.exec(html);
    assert.ok(re[2].startsWith(fig), b.tipo + ' primeiro filho');
  }
});

test('imagem: mime fora da lista, id ausente ou buffer invalido nao geram figura', () => {
  for (const b of todosTipos) {
    for (const imagens of [{ 7: { mime: 'image/svg+xml', buffer: PNG_B } }, { 7: { mime: 'image/gif', buffer: PNG_B } }, {}, { 8: mapa[7] }, { 7: { mime: 'image/png', buffer: 'x' } }]) {
      assert.ok(!renderEdition({ edicao, blocos: [comImg(b)], imagens }).includes('<figure'), b.tipo);
    }
    assert.ok(!renderEdition({ edicao, blocos: [comImg(b)] }).includes('<figure'), b.tipo + ' sem mapa');
  }
});

test('imagem: sem imagem o HTML dos blocos e identico ao render sem a chave', () => {
  const a = renderEdition({ edicao, blocos: todosTipos });
  assert.strictEqual(renderEdition({ edicao, blocos: todosTipos, imagens: {} }), a);
  assert.strictEqual(renderEdition({ edicao, blocos: todosTipos, imagens: mapa }), a);
  assert.ok(!a.includes('<figure'));
});

test('imagem: CSS da figura (35% a direita, limite de altura) e chamada do destaque com clear', () => {
  for (const mode of ['a4', 'web', 'strip']) {
    const css = buildCss({ mode, escala: 1 });
    assert.match(css, /\.img-bloco\{float:right;width:35%;/);
    assert.match(css, /\.img-bloco img\{[^}]*max-height:calc\(180px \* var\(--escala\)\);[^}]*object-fit:contain;[^}]*object-position:right top/);
    assert.match(css, /\.bloco::after\{content:"";display:block;clear:both;\}/);
    assert.match(css, /\.bloco-destaque \.chamada\{clear:both;/);
  }
});
