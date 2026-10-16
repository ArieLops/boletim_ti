process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_editions'; // banco próprio: arquivos de teste rodam em paralelo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetTestDb } = require('../helpers/testdb');
const { makeUsersRepo } = require('../../src/repos/users');
const { makeEditionsRepo, ConflictError } = require('../../src/repos/editions');
const { makeHistoryRepo } = require('../../src/repos/history');

let pool, users, ed, hist, ana, bia;
before(async () => {
  pool = await resetTestDb();
  users = makeUsersRepo(pool);
  ed = makeEditionsRepo(pool);
  hist = makeHistoryRepo(pool);
  ana = await users.createUser({ nome: 'Ana', login: 'ana', senha: 'senha-ana-1', perfil: 'editor' });
  bia = await users.createUser({ nome: 'Bia', login: 'bia', senha: 'senha-bia-1', perfil: 'editor' });
});
after(async () => {
  await pool.end();
});

const bloco = (titulo, extra = {}) => ({ tipo: 'texto', dados: { titulo, texto: 'conteúdo' }, ...extra });
const nova = (numero) => ed.createEdition({ numero, mesAno: 'Outubro 2026', titulo: `Edição ${numero}`, subtitulo: 'sub' }, ana);

test('nextNumber: 1 em base vazia, depois 2', async () => {
  assert.equal(await ed.nextNumber(), 1);
  await nova(1);
  assert.equal(await ed.nextNumber(), 2);
});

test('createEdition + getEdition: versão 1, rascunho, sem blocos; inexistente = null', async () => {
  const id = await nova(2);
  const r = await ed.getEdition(id);
  assert.equal(r.edicao.versao, 1);
  assert.equal(r.edicao.status, 'rascunho');
  assert.equal(r.edicao.mes_ano, 'Outubro 2026');
  assert.deepEqual(r.blocos, []);
  assert.equal(await ed.getEdition(999999), null);
});

test('saveEdition com versão atual incrementa, grava blocos em ordem e campos', async () => {
  const id = await nova(3);
  const v = await ed.saveEdition(id, {
    versao: 1,
    campos: { titulo: 'Novo título', mesAno: 'Nov 2026', subtitulo: 's2' },
    blocos: [bloco('A'), bloco('B')],
  }, ana);
  assert.equal(v, 2);
  const r = await ed.getEdition(id);
  assert.equal(r.edicao.versao, 2);
  assert.equal(r.edicao.titulo, 'Novo título');
  assert.equal(r.edicao.mes_ano, 'Nov 2026');
  assert.deepEqual(r.blocos.map((b) => [b.ordem, b.dados.titulo]), [[0, 'A'], [1, 'B']]);
});

test('ids dos blocos são estáveis entre saves; removidos somem; reordenar muda ordem', async () => {
  const id = await nova(4);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A'), bloco('B'), bloco('C')] }, ana);
  const [a, b, c] = (await ed.getEdition(id)).blocos;
  await ed.saveEdition(id, {
    versao: 2,
    campos: {},
    blocos: [{ id: c.id, tipo: c.tipo, dados: c.dados }, { id: a.id, tipo: a.tipo, dados: a.dados }, bloco('D')],
  }, ana);
  const depois = (await ed.getEdition(id)).blocos;
  assert.deepEqual(depois.slice(0, 2).map((x) => x.id), [c.id, a.id]);
  assert.deepEqual(depois.map((x) => x.dados.titulo), ['C', 'A', 'D']);
  assert.ok(!depois.some((x) => x.id === b.id));
});

test('versão antiga lança ConflictError com por = nome do outro editor', async () => {
  const id = await nova(5);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A')] }, bia);
  await assert.rejects(
    ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('Z')] }, ana),
    (e) => e instanceof ConflictError && e.por === 'Bia'
  );
  assert.equal((await ed.getEdition(id)).blocos[0].dados.titulo, 'A');
});

test('dois saves concorrentes com a mesma versão: um sucesso e um ConflictError', async () => {
  const id = await nova(6);
  const r = await Promise.allSettled([
    ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('X')] }, ana),
    ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('Y')] }, bia),
  ]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  const rej = r.filter((x) => x.status === 'rejected');
  assert.equal(rej.length, 1);
  assert.ok(rej[0].reason instanceof ConflictError);
  assert.equal((await ed.getEdition(id)).edicao.versao, 2);
});

test('edição publicada rejeita save; setStatus alterna e registra histórico', async () => {
  const id = await nova(7);
  await ed.setStatus(id, 'publicada', ana);
  await assert.rejects(ed.saveEdition(id, { versao: 1, campos: {}, blocos: [] }, ana), /publicada/);
  await ed.setStatus(id, 'rascunho', ana);
  assert.equal((await ed.getEdition(id)).edicao.status, 'rascunho');
  const acoes = (await hist.listHistory(id)).map((e) => e.acao);
  assert.equal(acoes.filter((a) => a === 'status_alterado').length, 2);
  await assert.rejects(ed.setStatus(id, 'invalido', ana));
});

test('bloco inválido ou de tipo desconhecido rejeita o save inteiro, sem gravar nada', async () => {
  const id = await nova(8);
  await assert.rejects(
    ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('ok'), { tipo: 'banner', dados: { titulo: 'x' } }] }, ana),
    /Bloco 1.*tipo desconhecido/
  );
  await assert.rejects(
    ed.saveEdition(id, { versao: 1, campos: {}, blocos: [{ tipo: 'card', dados: { titulo: 'x' } }] }, ana),
    /Bloco 0.*etiqueta/
  );
  const r = await ed.getEdition(id);
  assert.equal(r.edicao.versao, 1);
  assert.deepEqual(r.blocos, []);
});

test('cada save grava eventos com título do bloco; listHistory: recente primeiro, com nome', async () => {
  const id = await nova(9);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('Alfa'), bloco('Beta')] }, ana);
  const [alfa] = (await ed.getEdition(id)).blocos;
  await ed.saveEdition(id, {
    versao: 2,
    campos: {},
    blocos: [{ id: alfa.id, tipo: 'texto', dados: { titulo: 'Alfa', texto: 'mudou' } }],
  }, bia);
  const h = await hist.listHistory(id);
  assert.equal(h[0].usuario_nome, 'Bia');
  const find = (acao, titulo) => h.find((e) => e.acao === acao && e.detalhe.titulo === titulo);
  assert.ok(find('bloco_criado', 'Alfa'));
  assert.ok(find('bloco_criado', 'Beta'));
  assert.ok(find('bloco_alterado', 'Alfa'));
  assert.ok(find('bloco_removido', 'Beta'));
  assert.ok(h.some((e) => e.acao === 'edicao_criada'));
  assert.ok(h.some((e) => e.acao === 'edicao_salva' && e.detalhe.versao === 3));
});

test('listEditions traz o nome do último editor', async () => {
  const id = await nova(10);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [] }, bia);
  const lista = await ed.listEditions();
  const e = lista.find((x) => x.id === id);
  assert.equal(e.atualizado_por_nome, 'Bia');
  assert.ok(lista.length >= 3);
});

// ---------- saveToken (idempotência de salvamento) ----------
const salvasDe = async (id) => (await hist.listHistory(id)).filter((e) => e.acao === 'edicao_salva');

test('saveEdition com token grava {versao, token} no evento edicao_salva; sem token, só versao', async () => {
  const id = await nova(40);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A')], token: 'tok-1' }, ana);
  await ed.saveEdition(id, { versao: 2, campos: {}, blocos: [bloco('A')] }, ana);
  const [sem, com] = await salvasDe(id);
  assert.deepEqual(com.detalhe, { versao: 2, token: 'tok-1' });
  assert.deepEqual(sem.detalhe, { versao: 3 });
});

test('findRepeatedSave: token do último save na versão atual devolve a versão; outros casos null', async () => {
  const id = await nova(41);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A')], token: 'T' }, ana);
  assert.equal(await ed.findRepeatedSave(id, 'T'), 2);
  assert.equal(await ed.findRepeatedSave(id, 'outro'), null);
  assert.equal(await ed.findRepeatedSave(id, undefined), null);
  assert.equal(await ed.findRepeatedSave(id, ''), null);
  // outro usuário salva: o token T deixa de ser o último
  await ed.saveEdition(id, { versao: 2, campos: {}, blocos: [bloco('B')], token: 'U' }, bia);
  assert.equal(await ed.findRepeatedSave(id, 'T'), null);
  assert.equal(await ed.findRepeatedSave(id, 'U'), 3);
  // mesmo usuário em "segunda aba" (token diferente)
  await ed.saveEdition(id, { versao: 3, campos: {}, blocos: [bloco('C')], token: 'V' }, bia);
  assert.equal(await ed.findRepeatedSave(id, 'U'), null);
});

test('findRepeatedSave: edição publicada nunca é atalho', async () => {
  const id = await nova(42);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A')], token: 'T' }, ana);
  await ed.setStatus(id, 'publicada', ana);
  assert.equal(await ed.findRepeatedSave(id, 'T'), null);
});

test('DELETE FROM edicoes (receita do INSTALL.md) remove blocos, histórico e arquivos publicados em cascata', async () => {
  const id = await nova(999);
  await ed.saveEdition(id, { versao: 1, campos: {}, blocos: [bloco('A')] }, ana);
  await pool.query("INSERT INTO arquivos_publicados (edicao_id, tipo, conteudo, gerado_por) VALUES (?, 'pdf', 'x', ?)", [id, ana]);
  const conta = async (t) => (await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE edicao_id = ?`, [id]))[0][0].n;
  assert.ok((await conta('blocos')) > 0 && (await conta('historico')) > 0 && (await conta('arquivos_publicados')) > 0);
  await pool.query('DELETE FROM edicoes WHERE numero=999;');
  for (const t of ['blocos', 'historico', 'arquivos_publicados']) assert.equal(await conta(t), 0, t);
  assert.equal(await ed.getEdition(id), null);
});
