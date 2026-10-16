const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../src/public/editor-lib');

test('mover: sobe, desce e ignora limites sem alterar o original', () => {
  const a = ['a', 'b', 'c'];
  assert.deepEqual(lib.mover(a, 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(lib.mover(a, 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(lib.mover(a, 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(lib.mover(a, 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(lib.mover(a, 9, 1), ['a', 'b', 'c']);
  assert.deepEqual(a, ['a', 'b', 'c']);
});

test('textoAjuste: rótulos e classes do indicador', () => {
  assert.deepEqual(lib.textoAjuste('100'), { texto: '100%', classe: 'ok', limite: false });
  assert.deepEqual(lib.textoAjuste('88'), { texto: 'reduzido a 88%', classe: 'reduzido', limite: false });
  assert.deepEqual(lib.textoAjuste('limite'), { texto: 'passou do limite', classe: 'limite', limite: true });
  assert.deepEqual(lib.textoAjuste('indisponivel'), { texto: 'indisponível', classe: 'indisponivel', limite: false });
  assert.equal(lib.textoAjuste(null).classe, 'indisponivel');
  assert.equal(lib.textoAjuste('lixo').classe, 'indisponivel');
});

test('serializar: omite id de bloco novo e mantém o dos salvos', () => {
  const p = lib.serializar({
    versao: 3,
    campos: { mesAno: '2026-10', titulo: 'T', subtitulo: '' },
    blocos: [
      { id: 7, tipo: 'card', dados: { etiqueta: 'a', titulo: 'b', texto: 'c' } },
      { id: null, tipo: 'dica', dados: { titulo: 'x', texto: 'y' } },
    ],
  });
  assert.equal(p.versao, 3);
  assert.deepEqual(p.campos, { mesAno: '2026-10', titulo: 'T', subtitulo: '' });
  assert.equal(p.blocos[0].id, 7);
  assert.equal('id' in p.blocos[1], false);
  assert.deepEqual(p.blocos[1], { tipo: 'dica', dados: { titulo: 'x', texto: 'y' } });
});

test('validarLocal: aponta título, mês/ano e campos de bloco vazios', () => {
  const ok = { versao: 1, campos: { mesAno: '2026-10', titulo: 'T' }, blocos: [{ tipo: 'texto', dados: { titulo: 'a', texto: 'b' } }] };
  assert.deepEqual(lib.validarLocal(ok), []);
  const ruim = {
    versao: 1,
    campos: { mesAno: '10/2026', titulo: '  ' },
    blocos: [{ tipo: 'texto', dados: { titulo: 'a', texto: '' } }, { tipo: 'destaque', dados: { etiqueta: 'e', titulo: 't', texto: 'x', chamada: '' } }],
  };
  const erros = lib.validarLocal(ruim);
  assert.equal(erros.length, 4);
  assert.match(erros[0], /título/i);
  assert.match(erros[1], /mês\/ano/i);
  assert.match(erros[2], /bloco 1.*texto/i);
  assert.match(erros[3], /bloco 2.*chamada/i);
});

test('classificarErro: mapeia status/mensagem para a ação da interface', () => {
  assert.equal(lib.classificarErro(401, {}).tipo, 'sessao');
  const c = lib.classificarErro(409, { erro: 'esta edição foi alterada por Ana, recarregue' });
  assert.equal(c.tipo, 'conflito');
  assert.match(c.mensagem, /Ana/);
  assert.equal(lib.classificarErro(409, { erro: 'edição publicada; reabra para editar' }).tipo, 'publicada');
  assert.equal(lib.classificarErro(409, { erro: 'conteúdo será cortado' }).tipo, 'cortado');
  assert.equal(lib.classificarErro(400, { erro: 'bloco 1 inválido' }).tipo, 'validacao');
  const s = lib.classificarErro(503, { erro: 'x' });
  assert.equal(s.tipo, 'indisponivel');
  assert.equal(s.mensagem, 'Exportação indisponível no servidor. Avise a TI.');
  assert.equal(lib.classificarErro(500, null).tipo, 'outro');
});

test('precisaConfirmarCorte: só pdf/png-email com indicador no limite', () => {
  assert.equal(lib.precisaConfirmarCorte('pdf', 'limite'), true);
  assert.equal(lib.precisaConfirmarCorte('png-email', 'limite'), true);
  assert.equal(lib.precisaConfirmarCorte('png-whatsapp', 'limite'), false);
  assert.equal(lib.precisaConfirmarCorte('pdf', '90'), false);
});

test('nomeArquivo: extrai do Content-Disposition ou usa o padrão', () => {
  assert.equal(lib.nomeArquivo('attachment; filename="comunicado-001.pdf"', 'x.pdf'), 'comunicado-001.pdf');
  assert.equal(lib.nomeArquivo(null, 'x.pdf'), 'x.pdf');
});
