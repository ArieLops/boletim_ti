process.env.BOLETIM_TEST_DB = 'boletim_test_rt_editions';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');

let ctx, ex, edu, ana;
before(async () => {
  ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
});
after(() => ctx.close());

const novaEdicao = async (o = {}) => {
  const r = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Título', ...o });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
};

test('sem login, rotas de edição redirecionam para /login', async () => {
  const r = await request(ctx.app).get('/edicoes/1/preview');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/login');
});

test('POST /edicoes cria com número padrão sequencial e aceita número explícito', async () => {
  const a = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Primeira', subtitulo: 'Sub' });
  assert.equal(a.status, 201);
  assert.ok(Number.isInteger(a.body.id));
  const b = await edu.post('/edicoes', { mesAno: '2026-11', titulo: 'Segunda' });
  const [[ea]] = await ctx.pool.query('SELECT numero, subtitulo FROM edicoes WHERE id = ?', [a.body.id]);
  const [[eb]] = await ctx.pool.query('SELECT numero FROM edicoes WHERE id = ?', [b.body.id]);
  assert.equal(eb.numero, ea.numero + 1);
  assert.equal(ea.subtitulo, 'Sub');
  const c = await edu.post('/edicoes', { numero: 500, mesAno: '2026-12', titulo: 'Explícita' });
  assert.equal(c.status, 201);
});

test('POST /edicoes: número duplicado dá 409; entradas inválidas dão 400', async () => {
  await edu.post('/edicoes', { numero: 600, mesAno: '2026-10', titulo: 'X' });
  const dup = await edu.post('/edicoes', { numero: 600, mesAno: '2026-10', titulo: 'Y' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.erro, 'já existe uma edição com esse número');
  for (const ruim of [
    { mesAno: '2026-13', titulo: 'T' },
    { mesAno: 'out/2026', titulo: 'T' },
    { mesAno: '2026-10', titulo: '   ' },
    { mesAno: '2026-10' },
    { mesAno: '2026-10', titulo: 'T', numero: 0 },
    { mesAno: '2026-10', titulo: 'T', numero: 1.5 },
    { mesAno: '2026-10', titulo: 'T', numero: '7' },
    { mesAno: '2026-10', titulo: 'T', subtitulo: 5 },
  ]) {
    const r = await edu.post('/edicoes', ruim);
    assert.equal(r.status, 400, JSON.stringify(ruim));
    assert.ok(r.body.erro);
  }
});

test('PUT salva e devolve a nova versão; blocos persistem na ordem', async () => {
  const id = await novaEdicao();
  const r = await edu.put(`/edicoes/${id}`, {
    versao: 1,
    campos: { titulo: 'Novo título', mesAno: '2026-11', subtitulo: null },
    blocos: [blocoCard(1), blocoCard(2)],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { versao: 2 });
  const [[e]] = await ctx.pool.query('SELECT titulo, mes_ano, versao FROM edicoes WHERE id = ?', [id]);
  assert.equal(e.titulo, 'Novo título');
  assert.equal(e.mes_ano, '2026-11');
  const [bl] = await ctx.pool.query('SELECT id FROM blocos WHERE edicao_id = ? ORDER BY ordem', [id]);
  assert.equal(bl.length, 2);
  // reaproveita ids ao salvar de novo
  const r2 = await edu.put(`/edicoes/${id}`, { versao: 2, blocos: [blocoCard(2, { id: bl[1].id }), blocoCard(1, { id: bl[0].id })] });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.versao, 3);
});

test('PUT com versão antiga: 409 com "foi alterada por <usuário>, recarregue"', async () => {
  const id = await novaEdicao();
  assert.equal((await edu.put(`/edicoes/${id}`, { versao: 1, blocos: [blocoCard()] })).status, 200);
  const r = await ana.put(`/edicoes/${id}`, { versao: 1, blocos: [blocoCard()] });
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'esta edição foi alterada por Edu, recarregue');
});

test('PUT em edição publicada: 409', async () => {
  const id = await novaEdicao();
  assert.equal((await edu.post(`/edicoes/${id}/publicar`)).status, 200);
  const r = await edu.put(`/edicoes/${id}`, { versao: 1, blocos: [] });
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'edição publicada; reabra para editar');
});

test('PUT: id desconhecido ou malformado dá 404', async () => {
  for (const id of ['999999', 'abc', '0', '1e3']) {
    assert.equal((await edu.put(`/edicoes/${id}`, { versao: 1, blocos: [] })).status, 404, id);
  }
});

test('PUT: validações dão 400 com mensagem e não alteram a edição', async () => {
  const id = await novaEdicao();
  const casos = [
    { versao: '1', blocos: [] },
    { versao: 1.5, blocos: [] },
    { blocos: [] },
    { versao: 1, blocos: 'x' },
    { versao: 1 },
    { versao: 1, blocos: [null] },
    { versao: 1, blocos: ['texto'] },
    { versao: 1, blocos: [[1]] },
    { versao: 1, blocos: [{ tipo: 'card', dados: {} }] },
    { versao: 1, blocos: [{ tipo: 'inexistente', dados: {} }] },
    { versao: 1, blocos: [blocoCard(1, { id: 5 }), blocoCard(2, { id: 5 })] },
    { versao: 1, blocos: [blocoCard(1, { id: 'x' })] },
    { versao: 1, blocos: [], campos: { titulo: '' } },
    { versao: 1, blocos: [], campos: { titulo: 7 } },
    { versao: 1, blocos: [], campos: { mesAno: '2026/10' } },
    { versao: 1, blocos: [], campos: { mesAno: '' } },
    { versao: 1, blocos: [], campos: 'x' },
    { versao: 1, blocos: [], campos: { subtitulo: 3 } },
  ];
  for (const c of casos) {
    const r = await edu.put(`/edicoes/${id}`, c);
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.ok(typeof r.body.erro === 'string' && r.body.erro.length > 0);
  }
  const [[e]] = await ctx.pool.query('SELECT versao FROM edicoes WHERE id = ?', [id]);
  assert.equal(e.versao, 1);
});

test('preview: HTML com X-Ajuste conforme o fit; escala do fit chega ao HTML', async () => {
  const id = await novaEdicao({ titulo: 'Prévia <b>x' });
  ex.fitResult = { scale: 1, estouro: false, faltaMm: 0 };
  const a = await edu.get(`/edicoes/${id}/preview`);
  assert.equal(a.status, 200);
  assert.match(a.headers['content-type'], /text\/html/);
  assert.equal(a.headers['x-ajuste'], '100');
  assert.match(a.text, /Prévia &lt;b&gt;x/);
  assert.match(a.text, /--escala:1[;}]/);
  ex.fitResult = { scale: 0.88, estouro: false, faltaMm: 0 };
  const b = await edu.get(`/edicoes/${id}/preview`);
  assert.equal(b.headers['x-ajuste'], '88');
  assert.match(b.text, /--escala:0\.88[;}]/);
  ex.fitResult = { scale: 0.75, estouro: true, faltaMm: 12 };
  const c = await edu.get(`/edicoes/${id}/preview`);
  assert.equal(c.headers['x-ajuste'], 'limite');
  ex.fitResult = { scale: 1, estouro: false, faltaMm: 0 };
});

test('preview com exportador indisponível: 200, escala 1 e X-Ajuste: indisponivel', async () => {
  const id = await novaEdicao();
  ex.indisponivel = true;
  try {
    const r = await edu.get(`/edicoes/${id}/preview`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-ajuste'], 'indisponivel');
    assert.match(r.text, /--escala:1[;}]/);
  } finally {
    ex.indisponivel = false;
  }
});

test('preview: 404 para id desconhecido', async () => {
  assert.equal((await edu.get('/edicoes/987654/preview')).status, 404);
  assert.equal((await edu.get('/edicoes/abc/preview')).status, 404);
});

test('preview usa o piso das configurações a cada requisição', async () => {
  const id = await novaEdicao();
  await ctx.pool.query("REPLACE INTO configuracoes (chave, valor) VALUES ('pisoReducao','0.6')");
  ex.reset();
  await edu.get(`/edicoes/${id}/preview`);
  assert.deepEqual(ex.pisos, [0.6]);
  await ctx.pool.query("DELETE FROM configuracoes WHERE chave='pisoReducao'");
});
