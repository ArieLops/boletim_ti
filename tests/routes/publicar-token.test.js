process.env.BOLETIM_TEST_DB = 'boletim_test_publicar_token';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter, blocoCard } = require('../helpers/routes');
const { makeHistoryRepo } = require('../../src/repos/history');
const { makeEditionsRepo } = require('../../src/repos/editions');
const { tokenValido } = require('../../src/domain/token');

let ctx, ex, edu, hist;
before(async () => {
  ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  hist = makeHistoryRepo(ctx.pool);
});
after(() => ctx.close());
beforeEach(() => {
  ex.reset();
  ex.fitResult = { scale: 1, estouro: false, faltaMm: 0 };
  ex.falhaEm = null;
});

const nova = async () => {
  const r = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Edição' });
  assert.equal(r.status, 201);
  await edu.put(`/edicoes/${r.body.id}`, { versao: 1, blocos: [blocoCard(1)] });
  return r.body.id;
};
const tokenNoBanco = async (id) => (await ctx.pool.query('SELECT token_publico FROM edicoes WHERE id = ?', [id]))[0][0].token_publico;
const acoes = async (id) => (await hist.listHistory(id)).map((h) => h.acao);

test('publicar devolve token válido e o grava na edição', async () => {
  const id = await nova();
  const r = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'publicada');
  assert.ok(tokenValido(r.body.token), r.body.token);
  assert.equal(await tokenNoBanco(id), r.body.token);
  const { edicao } = await makeEditionsRepo(ctx.pool).getEdition(id);
  assert.equal(edicao.token_publico, r.body.token);
  const h = (await hist.listHistory(id)).find((e) => e.acao === 'link_publico_criado');
  assert.deepEqual(h.detalhe, { numero: edicao.numero });
});

test('histórico tem um único link_publico_criado; reabrir e republicar mantém o token sem novo evento', async () => {
  const id = await nova();
  const r1 = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal((await acoes(id)).filter((a) => a === 'link_publico_criado').length, 1);
  assert.equal((await edu.post(`/edicoes/${id}/reabrir`)).status, 200);
  assert.equal(await tokenNoBanco(id), r1.body.token, 'reabrir não apaga o token');
  const r2 = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.token, r1.body.token);
  const a = await acoes(id);
  assert.equal(a.filter((x) => x === 'link_publico_criado').length, 1);
  assert.equal(a.filter((x) => x === 'publicada').length, 2);
});

test('edições diferentes têm tokens diferentes', async () => {
  const a = (await edu.post(`/edicoes/${await nova()}/publicar`)).body.token;
  const b = (await edu.post(`/edicoes/${await nova()}/publicar`)).body.token;
  assert.notEqual(a, b);
});

test('falha do exportador (503) não cria token nem evento', async () => {
  const id = await nova();
  ex.falhaEm = 'pdf';
  assert.equal((await edu.post(`/edicoes/${id}/publicar`)).status, 503);
  assert.equal(await tokenNoBanco(id), null);
  assert.ok(!(await acoes(id)).includes('link_publico_criado'));
});

test('falha após o UPDATE do token desfaz o token (mesma transação)', async () => {
  const id = await nova();
  const pool = ctx.app.locals.pool;
  const original = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await original();
    const q = conn.query.bind(conn);
    conn.query = async (sql, ...rest) => {
      // o evento 'publicada' é gravado depois do UPDATE que define o token
      if (typeof sql === 'string' && /INSERT INTO historico/i.test(sql) && rest[0] && rest[0][2] === 'publicada') {
        throw new Error('falha simulada após o token');
      }
      return q(sql, ...rest);
    };
    return conn;
  };
  const logs = console.error;
  console.error = () => {};
  try {
    assert.equal((await edu.post(`/edicoes/${id}/publicar`)).status, 500);
  } finally {
    console.error = logs;
    pool.getConnection = original;
  }
  assert.equal(await tokenNoBanco(id), null);
  assert.equal((await ctx.pool.query('SELECT status FROM edicoes WHERE id = ?', [id]))[0][0].status, 'rascunho');
});

test('colisão do token (ER_DUP_ENTRY) tenta de novo com outro token', async () => {
  const idA = await nova();
  const tA = (await edu.post(`/edicoes/${idA}/publicar`)).body.token;
  const id = await nova();
  const tokenMod = require('../../src/domain/token');
  const original = tokenMod.novoToken;
  let n = 0;
  tokenMod.novoToken = () => (n++ < 2 ? tA : original());
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.notEqual(r.body.token, tA);
    assert.equal(await tokenNoBanco(id), r.body.token);
    assert.equal(n, 3);
  } finally {
    tokenMod.novoToken = original;
  }
});

test('colisão em todas as 3 tentativas: publicação falha e nada fica para trás', async () => {
  const idA = await nova();
  const tA = (await edu.post(`/edicoes/${idA}/publicar`)).body.token;
  const id = await nova();
  const tokenMod = require('../../src/domain/token');
  const original = tokenMod.novoToken;
  let n = 0;
  tokenMod.novoToken = () => { n++; return tA; };
  const logs = console.error;
  console.error = () => {};
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.ok(r.status >= 500, String(r.status));
    assert.equal(n, 3);
  } finally {
    console.error = logs;
    tokenMod.novoToken = original;
  }
  assert.equal((await ctx.pool.query('SELECT status FROM edicoes WHERE id = ?', [id]))[0][0].status, 'rascunho');
  assert.equal(await tokenNoBanco(id), null);
  assert.ok(!(await acoes(id)).includes('link_publico_criado'));
  assert.equal(Number((await ctx.pool.query('SELECT COUNT(*) AS n FROM arquivos_publicados WHERE edicao_id = ?', [id]))[0][0].n), 0);
});
