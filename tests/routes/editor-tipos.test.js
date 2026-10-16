process.env.BOLETIM_TEST_DB = 'boletim_test_editor_tipos';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');
const { makeEditionsRepo } = require('../../src/repos/editions');
const { makeHistoryRepo } = require('../../src/repos/history');

const TIPOS = {
  destaque: ['Destaque', 'Cartão grande com etiqueta, título, texto e linha de chamada. Para o assunto principal da semana.'],
  card: ['Card', 'Cartão menor com etiqueta, título e texto. Cards seguidos ficam lado a lado.'],
  dica: ['Dica', 'Faixa verde com ponto amarelo, título e texto. Para dicas de segurança e avisos curtos.'],
  texto: ['Texto livre', 'Título e parágrafo simples, sem caixa nem cor. Para texto corrido.'],
};

let ctx, ana, repo, hist, id, pubId, blocoIds;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  repo = makeEditionsRepo(ctx.pool);
  hist = makeHistoryRepo(ctx.pool);
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
  id = (await ana.post('/edicoes', { mesAno: '2026-10', titulo: 'Tipos' })).body.id;
  const s = await ana.put(`/edicoes/${id}`, {
    versao: 1,
    campos: {},
    blocos: [
      blocoCard(1),
      { tipo: 'texto', dados: { titulo: 'Livre', texto: 'Parágrafo' } },
      { tipo: 'destaque', dados: { etiqueta: 'E', titulo: 'D', texto: 'T', chamada: 'C' } },
    ],
  });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  blocoIds = (await repo.getEdition(id)).blocos.map((b) => b.id);
  pubId = (await ana.post('/edicoes', { mesAno: '2026-11', titulo: 'Pub' })).body.id;
  await ana.put(`/edicoes/${pubId}`, { versao: 1, campos: {}, blocos: [blocoCard(1)] });
  assert.equal((await ana.post(`/edicoes/${pubId}/publicar`, {})).status, 200);
});
after(() => ctx.close());

const botoes = (html) => html.match(/<button[^>]*data-adicionar="[^"]+"[\s\S]*?<\/button>/g) || [];

test('editor traz quatro cartões de tipo com nome e descrição, sem botões "+ Tipo"', async () => {
  const html = (await ana.get(`/edicoes/${id}`)).text;
  const cartoes = botoes(html);
  assert.equal(cartoes.length, 4);
  for (const [tipo, [nome, desc]] of Object.entries(TIPOS)) {
    const c = cartoes.find((b) => b.includes(`data-adicionar="${tipo}"`));
    assert.ok(c, tipo);
    assert.match(c, /type="button"/);
    assert.ok(c.includes(nome), `nome ${nome}`);
    assert.ok(c.includes(desc), `descrição ${tipo}`);
    assert.match(c, /aria-label="Adicionar [^"]*"/);
    assert.ok(c.includes(`aria-label="Adicionar ${nome}: ${desc}"`), 'nome acessível');
    assert.match(c, /aria-hidden="true"/);
  }
  assert.doesNotMatch(html, /\+ (Destaque|Card|Dica|Texto livre)/);
});

test('o template de cada tipo existe na página (usado pelo cliente ao adicionar/trocar)', async () => {
  const html = (await ana.get(`/edicoes/${id}`)).text;
  for (const tipo of Object.keys(TIPOS)) {
    const i = html.indexOf(`<template id="tpl-${tipo}">`);
    assert.ok(i >= 0 && html.slice(i, html.indexOf("</template>", i)).includes(`data-tipo="${tipo}"`), tipo);
  }
});

test('cada bloco tem select de tipo com 4 opções, atual selecionado e sem name', async () => {
  const html = (await ana.get(`/edicoes/${id}`)).text;
  const lista = html.slice(html.indexOf('id="lista-blocos"'), html.indexOf('id="blocos-vazios"'));
  const selects = lista.match(/<select[\s\S]*?<\/select>/g);
  assert.equal(selects.length, 3);
  ['card', 'texto', 'destaque'].forEach((tipo, i) => {
    const s = selects[i];
    assert.match(s, /data-tipo-select/);
    assert.match(s, /aria-label="Tipo do bloco"/);
    assert.doesNotMatch(s.match(/<select[^>]*>/)[0], /\bname=|data-acao|\bdisabled\b/);
    assert.equal((s.match(/<option/g) || []).length, 4);
    assert.equal((s.match(/<option[^>]*\bselected\b/g) || []).length, 1);
    assert.match(s, new RegExp(`<option[^>]*value="${tipo}"[^>]*selected|<option[^>]*selected[^>]*value="${tipo}"`));
    for (const [, [nome]] of Object.entries(TIPOS)) assert.ok(s.includes(`>${nome}</option>`), nome);
  });
});

test('edição publicada: selects desabilitados e sem cartões de tipo', async () => {
  const html = (await ana.get(`/edicoes/${pubId}`)).text;
  assert.equal(botoes(html).length, 0);
  assert.doesNotMatch(html, /Cartão grande com etiqueta/);
  const selects = html.match(/<select[^>]*data-tipo-select[^>]*>/g);
  assert.equal(selects.length, 1);
  assert.match(selects[0], /\bdisabled\b/);
});

test('PUT com outro tipo no mesmo id atualiza o bloco (texto -> dica) e registra bloco_alterado', async () => {
  const ed = await repo.getEdition(id);
  const antes = await hist.listHistory(id);
  const r = await ana.put(`/edicoes/${id}`, {
    versao: ed.edicao.versao,
    campos: {},
    blocos: [
      { id: blocoIds[0], tipo: 'card', dados: ed.blocos[0].dados },
      { id: blocoIds[1], tipo: 'dica', dados: { titulo: 'Livre', texto: 'Parágrafo' } },
      { id: blocoIds[2], tipo: 'destaque', dados: ed.blocos[2].dados },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const depois = await repo.getEdition(id);
  assert.deepEqual(depois.blocos.map((b) => b.id), blocoIds);
  assert.equal(depois.blocos[1].tipo, 'dica');
  assert.deepEqual(depois.blocos[1].dados, { titulo: 'Livre', texto: 'Parágrafo' });
  const novos = (await hist.listHistory(id)).filter((h) => !antes.some((a) => a.id === h.id));
  assert.ok(novos.some((h) => h.acao === 'bloco_alterado'), JSON.stringify(novos.map((h) => h.acao)));
});

test('destaque -> dica com campos extras guarda só titulo e texto', async () => {
  const ed = await repo.getEdition(id);
  const r = await ana.put(`/edicoes/${id}`, {
    versao: ed.edicao.versao,
    campos: {},
    blocos: [
      { id: blocoIds[0], tipo: 'card', dados: ed.blocos[0].dados },
      { id: blocoIds[1], tipo: 'dica', dados: ed.blocos[1].dados },
      { id: blocoIds[2], tipo: 'dica', dados: { etiqueta: 'E', titulo: 'D', texto: 'T', chamada: 'C' } },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = (await repo.getEdition(id)).blocos[2];
  assert.equal(b.id, blocoIds[2]);
  assert.equal(b.tipo, 'dica');
  assert.deepEqual(b.dados, { titulo: 'D', texto: 'T' });
});
