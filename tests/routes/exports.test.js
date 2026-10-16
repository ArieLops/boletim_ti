process.env.BOLETIM_TEST_DB = 'boletim_test_rt_exports';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, entrar, fakeExporter, blocoCard, PNG_SIG } = require('../helpers/routes');
const { makeFilesRepo } = require('../../src/repos/files');
const { makeHistoryRepo } = require('../../src/repos/history');

let ctx, ex, edu, ana, files, hist;
before(async () => {
  ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  ana = await entrar(ctx.app, 'ana', 'senha-ana-123');
  files = makeFilesRepo(ctx.pool);
  hist = makeHistoryRepo(ctx.pool);
});
after(() => ctx.close());
beforeEach(() => {
  ex.reset();
  ex.fitResult = { scale: 1, estouro: false, faltaMm: 0 };
  ex.info = { largura: 1080, altura: 1500, muitoAlta: false };
  ex.indisponivel = false;
  ex.falhaEm = null;
});

const nova = async (o = {}) => {
  const r = await edu.post('/edicoes', { mesAno: '2026-10', titulo: 'Edição', ...o });
  assert.equal(r.status, 201);
  await edu.put(`/edicoes/${r.body.id}`, { versao: 1, blocos: [blocoCard(1)] });
  return r.body.id;
};
const statusDe = async (id) => (await ctx.pool.query('SELECT status FROM edicoes WHERE id = ?', [id]))[0][0].status;
const nArquivos = async (id) => Number((await ctx.pool.query('SELECT COUNT(*) AS n FROM arquivos_publicados WHERE edicao_id = ?', [id]))[0][0].n);
const acoes = async (id) => (await hist.listHistory(id)).map((h) => h.acao);
const binario = (req) => req.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

test('publicar grava os 3 arquivos, muda o status e registra no histórico', async () => {
  const id = await nova();
  const r = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await statusDe(id), 'publicada');
  assert.equal(await nArquivos(id), 3);
  assert.ok((await files.getFile(id, 'pdf')).conteudo.subarray(0, 4).toString() === '%PDF');
  assert.ok((await files.getFile(id, 'png_email')).conteudo.subarray(0, 8).equals(PNG_SIG));
  assert.ok(await acoes(id).then((a) => a.includes('publicada')));
});

test('publicar usa o piso das configurações', async () => {
  await ctx.pool.query("REPLACE INTO configuracoes (chave, valor) VALUES ('pisoReducao','0.65')");
  const id = await nova();
  await edu.post(`/edicoes/${id}/publicar`);
  assert.ok(ex.pisos.length >= 2 && ex.pisos.every((p) => p === 0.65), JSON.stringify(ex.pisos));
  await ctx.pool.query("DELETE FROM configuracoes WHERE chave='pisoReducao'");
});

test('publicar com estouro sem confirmar: 409 "conteúdo será cortado" e nada muda', async () => {
  const id = await nova();
  ex.fitResult = { scale: 0.75, estouro: true, faltaMm: 23.4 };
  const r = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(r.status, 409);
  assert.equal(r.body.erro, 'conteúdo será cortado');
  assert.equal(r.body.faltaMm, 23.4);
  assert.equal(await statusDe(id), 'rascunho');
  assert.equal(await nArquivos(id), 0);
  const ok = await edu.post(`/edicoes/${id}/publicar?confirmar=1`);
  assert.equal(ok.status, 200);
  assert.equal(await statusDe(id), 'publicada');
});

test('publicar aceita confirmar=1 também no corpo', async () => {
  const id = await nova();
  ex.fitResult = { scale: 0.75, estouro: true, faltaMm: 5 };
  assert.equal((await edu.post(`/edicoes/${id}/publicar`, { confirmar: '1' })).status, 200);
});

test('exportador falha ao publicar: 503, status rascunho e nenhum arquivo parcial', async () => {
  const id = await nova();
  for (const etapa of ['pdf', 'pngEmail', 'pngWhatsapp', 'fit']) {
    ex.falhaEm = etapa;
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 503, etapa);
    assert.match(r.body.erro, /Chromium indisponível/);
    assert.equal(await statusDe(id), 'rascunho', etapa);
    assert.equal(await nArquivos(id), 0, etapa);
    assert.ok(!(await acoes(id)).includes('publicada'));
  }
});

test('falha inesperada do exportador ao publicar: 503 com mensagem fixa, sem vazar e.message', async () => {
  const id = await nova();
  const original = ex.pdf;
  ex.pdf = async () => { throw new Error('ENOENT /usr/bin/chromium detalhe interno'); };
  const logs = console.error;
  const registrados = [];
  console.error = (...a) => registrados.push(a);
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 503);
    assert.equal(r.body.erro, 'Não foi possível gerar os arquivos agora. Tente novamente ou avise a TI.');
    assert.ok(!/ENOENT|chromium/i.test(r.text));
    assert.ok(registrados.some((a) => a.some((x) => x instanceof Error && /ENOENT/.test(x.message))), 'erro real deve ser logado');
    assert.equal(await statusDe(id), 'rascunho');
  } finally {
    console.error = logs;
    ex.pdf = original;
  }
});

test('falha inesperada ao gravar na publicação desfaz tudo (atomicidade)', async () => {
  const id = await nova();
  const original = ctx.app.locals.files.saveFiles;
  ctx.app.locals.files.saveFiles = async () => { throw new Error('falha simulada no banco'); };
  const logs = console.error;
  console.error = () => {};
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 500);
  } finally {
    console.error = logs;
    ctx.app.locals.files.saveFiles = original;
  }
  assert.equal(await statusDe(id), 'rascunho');
  assert.equal(await nArquivos(id), 0);
});

test('publicar de novo: 409; id desconhecido: 404; reabrir rascunho: 409', async () => {
  const id = await nova();
  assert.equal((await edu.post(`/edicoes/${id}/publicar`)).status, 200);
  const again = await edu.post(`/edicoes/${id}/publicar`);
  assert.equal(again.status, 409);
  assert.equal(again.body.erro, 'edição já publicada');
  assert.equal((await edu.post('/edicoes/999999/publicar')).status, 404);
  assert.equal((await edu.post('/edicoes/999999/reabrir')).status, 404);
  const id2 = await nova();
  const rr = await edu.post(`/edicoes/${id2}/reabrir`);
  assert.equal(rr.status, 409);
  assert.equal(rr.body.erro, 'edição já está em rascunho');
});

test('reabrir volta a rascunho, apaga arquivos, registra "reaberta" e libera edição', async () => {
  const id = await nova();
  await edu.post(`/edicoes/${id}/publicar`);
  const r = await ana.post(`/edicoes/${id}/reabrir`);
  assert.equal(r.status, 200);
  assert.equal(await statusDe(id), 'rascunho');
  assert.equal(await nArquivos(id), 0);
  const a = await acoes(id);
  assert.ok(a.includes('reaberta'));
  const [[e]] = await ctx.pool.query('SELECT versao FROM edicoes WHERE id = ?', [id]);
  assert.equal((await edu.put(`/edicoes/${id}`, { versao: e.versao, blocos: [blocoCard(2)] })).status, 200);
});

test('download de publicada devolve exatamente os bytes do banco sem chamar o exportador', async () => {
  const id = await nova();
  await edu.post(`/edicoes/${id}/publicar`);
  const pdf = (await files.getFile(id, 'pdf')).conteudo;
  const pe = (await files.getFile(id, 'png_email')).conteudo;
  const pw = (await files.getFile(id, 'png_whatsapp')).conteudo;
  ex.reset();
  ex.indisponivel = true; // se chamasse o exportador, daria 503
  const [a, b, c] = await Promise.all([
    binario(edu.get(`/edicoes/${id}/download/pdf`)),
    binario(edu.get(`/edicoes/${id}/download/png-email`)),
    binario(edu.get(`/edicoes/${id}/download/png-whatsapp`)),
  ]);
  assert.equal(a.status, 200);
  assert.ok(a.body.equals(pdf));
  assert.ok(b.body.equals(pe));
  assert.ok(c.body.equals(pw));
  assert.deepEqual(Object.values(ex.calls), [0, 0, 0, 0, 0]);
  assert.equal(a.headers['content-type'], 'application/pdf');
  assert.equal(b.headers['content-type'], 'image/png');
  assert.equal(c.headers['content-type'], 'image/png');
  const [[{ numero }]] = await ctx.pool.query('SELECT numero FROM edicoes WHERE id = ?', [id]);
  const n = String(numero).padStart(3, '0');
  assert.equal(a.headers['content-disposition'], `attachment; filename="comunicado-${n}.pdf"`);
  assert.equal(b.headers['content-disposition'], `attachment; filename="comunicado-${n}-email.png"`);
  assert.equal(c.headers['content-disposition'], `attachment; filename="comunicado-${n}-whatsapp.png"`);
  assert.equal(a.headers['cache-control'], 'no-store');
});

test('download de publicada: png-whatsapp muito alto traz X-Aviso (lido do PNG guardado)', async () => {
  const id = await nova();
  ex.info = { largura: 1080, altura: 5000, muitoAlta: true };
  await edu.post(`/edicoes/${id}/publicar`);
  ex.reset();
  const r = await binario(edu.get(`/edicoes/${id}/download/png-whatsapp`));
  assert.equal(r.headers['x-aviso'], 'imagem muito alta');
  const ok = await nova();
  ex.info = { largura: 1080, altura: 1500, muitoAlta: false };
  await edu.post(`/edicoes/${ok}/publicar`);
  assert.equal((await binario(edu.get(`/edicoes/${ok}/download/png-whatsapp`))).headers['x-aviso'], undefined);
});

test('download de rascunho gera na hora, sem gravar arquivos', async () => {
  const id = await nova();
  const r = await binario(edu.get(`/edicoes/${id}/download/pdf`));
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  assert.equal(ex.calls.pdf, 1);
  assert.equal(await nArquivos(id), 0);
  const e = await binario(edu.get(`/edicoes/${id}/download/png-email`));
  assert.ok(e.body.subarray(0, 8).equals(PNG_SIG));
  assert.match(e.headers['content-disposition'], /-email\.png"$/);
});

test('download de rascunho: png-whatsapp muito alto avisa; normal não', async () => {
  const id = await nova();
  ex.info = { largura: 1080, altura: 6000, muitoAlta: true };
  assert.equal((await binario(edu.get(`/edicoes/${id}/download/png-whatsapp`))).headers['x-aviso'], 'imagem muito alta');
  ex.info = { largura: 1080, altura: 900, muitoAlta: false };
  assert.equal((await binario(edu.get(`/edicoes/${id}/download/png-whatsapp`))).headers['x-aviso'], undefined);
});

test('download A4 com estouro exige confirmar=1; whatsapp não depende do fit', async () => {
  const id = await nova();
  ex.fitResult = { scale: 0.75, estouro: true, faltaMm: 9 };
  for (const tipo of ['pdf', 'png-email']) {
    const r = await edu.get(`/edicoes/${id}/download/${tipo}`);
    assert.equal(r.status, 409, tipo);
    assert.equal(r.body.erro, 'conteúdo será cortado');
    assert.equal(r.body.faltaMm, 9);
    const ok = await binario(edu.get(`/edicoes/${id}/download/${tipo}?confirmar=1`));
    assert.equal(ok.status, 200, tipo);
  }
  const w = await binario(edu.get(`/edicoes/${id}/download/png-whatsapp`));
  assert.equal(w.status, 200);
});

test('download registra "baixou" com o tipo no histórico', async () => {
  const id = await nova();
  await binario(edu.get(`/edicoes/${id}/download/pdf`));
  await binario(edu.get(`/edicoes/${id}/download/png-whatsapp`));
  const baixou = (await hist.listHistory(id)).filter((h) => h.acao === 'baixou').map((h) => h.detalhe.tipo).sort();
  assert.deepEqual(baixou, ['pdf', 'png-whatsapp']);
  // 409 por estouro não conta como download
  ex.fitResult = { scale: 0.75, estouro: true, faltaMm: 1 };
  await edu.get(`/edicoes/${id}/download/pdf`);
  assert.equal((await hist.listHistory(id)).filter((h) => h.acao === 'baixou').length, 2);
});

test('download com Chromium indisponível: 503 com mensagem clara; nada é registrado', async () => {
  const id = await nova();
  ex.indisponivel = true;
  const r = await edu.get(`/edicoes/${id}/download/pdf`);
  assert.equal(r.status, 503);
  assert.match(r.body.erro, /Chromium indisponível/);
  assert.ok(!(await acoes(id)).includes('baixou'));
});

test('download: tipo inválido ou id desconhecido dá 404', async () => {
  const id = await nova();
  for (const t of ['exe', 'png_email', 'PDF', 'png']) assert.equal((await edu.get(`/edicoes/${id}/download/${t}`)).status, 404, t);
  assert.equal((await edu.get('/edicoes/999999/download/pdf')).status, 404);
  assert.equal((await edu.get('/edicoes/abc/download/pdf')).status, 404);
});

test('isolamento: cada edição baixa só os próprios arquivos', async () => {
  const a = await nova();
  const b = await nova();
  await edu.post(`/edicoes/${a}/publicar`);
  await edu.post(`/edicoes/${b}/publicar`);
  const da = await binario(edu.get(`/edicoes/${a}/download/pdf`));
  const db = await binario(edu.get(`/edicoes/${b}/download/pdf`));
  assert.ok(da.body.equals((await files.getFile(a, 'pdf')).conteudo));
  assert.ok(db.body.equals((await files.getFile(b, 'pdf')).conteudo));
  assert.ok(!da.body.equals(db.body));
});

test('publicada sem arquivos no banco (inconsistência) gera na hora em vez de falhar', async () => {
  const id = await nova();
  await ctx.pool.query("UPDATE edicoes SET status='publicada' WHERE id = ?", [id]);
  const r = await binario(edu.get(`/edicoes/${id}/download/pdf`));
  assert.equal(r.status, 200);
  assert.equal(ex.calls.pdf, 1);
});

test('publicar: edição alterada durante a geração -> 409 e nada é gravado (guarda de versão)', async () => {
  const id = await nova();
  const pdfOriginal = ex.pdf;
  ex.pdf = async (...args) => {
    const r = await edu.put(`/edicoes/${id}`, { versao: 2, blocos: [blocoCard(9)] }); // edição concorrente
    assert.equal(r.status, 200);
    return pdfOriginal(...args);
  };
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 409);
    assert.equal(r.body.erro, 'a edição foi alterada durante a publicação; tente novamente');
  } finally {
    ex.pdf = pdfOriginal;
  }
  assert.equal(await statusDe(id), 'rascunho');
  assert.equal(await nArquivos(id), 0);
  assert.ok(!(await acoes(id)).includes('publicada'));
});

test('publicar: falha DEPOIS de saveFiles dentro da transação desfaz arquivos e status juntos', async () => {
  const id = await nova();
  const original = ctx.pool.getConnection;
  // Faz o INSERT do histórico (último passo antes do commit) falhar nas conexões obtidas durante o teste.
  ctx.pool.getConnection = async (...a) => {
    const c = await original.apply(ctx.pool, a);
    const q = c.query;
    const rel = c.release;
    c.query = (sql, ...r) => (/INSERT INTO historico/.test(String(sql)) ? Promise.reject(new Error('falha simulada no histórico')) : q.call(c, sql, ...r));
    c.release = (...r) => { c.query = q; c.release = rel; return rel.apply(c, r); };
    return c;
  };
  const logs = console.error;
  console.error = () => {};
  try {
    const r = await edu.post(`/edicoes/${id}/publicar`);
    assert.equal(r.status, 500);
  } finally {
    console.error = logs;
    ctx.pool.getConnection = original;
  }
  assert.equal(await nArquivos(id), 0, 'arquivos devem ter sido desfeitos');
  assert.equal(await statusDe(id), 'rascunho');
  // sem a falha, a mesma edição publica normalmente
  assert.equal((await edu.post(`/edicoes/${id}/publicar`)).status, 200);
  assert.equal(await nArquivos(id), 3);
});
