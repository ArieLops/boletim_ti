process.env.BOLETIM_TEST_DB = 'boletim_test_files';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resetTestDb } = require('../helpers/testdb');
const { makeUsersRepo } = require('../../src/repos/users');
const { makeEditionsRepo } = require('../../src/repos/editions');
const { makeFilesRepo } = require('../../src/repos/files');
const { makeSettingsRepo } = require('../../src/repos/settings');

let pool, files, settings, editions, uid, e1, e2;
before(async () => {
  pool = await resetTestDb();
  uid = await makeUsersRepo(pool).createUser({ nome: 'U', login: 'u', senha: 'senha-u-1234', perfil: 'editor' });
  editions = makeEditionsRepo(pool);
  files = makeFilesRepo(pool);
  settings = makeSettingsRepo(pool);
  e1 = await editions.createEdition({ numero: 1, mesAno: '2026-10', titulo: 'A' }, uid);
  e2 = await editions.createEdition({ numero: 2, mesAno: '2026-10', titulo: 'B' }, uid);
});
after(() => pool.end());

const bin = (n) => crypto.randomBytes(n);

test('saveFiles/getFile: bytes idênticos (inclui binário com zeros e 300 KB)', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), bin(300 * 1024), Buffer.from([0, 0, 0, 255])]);
  const pe = bin(2000), pw = bin(3000);
  await files.saveFiles(e1, uid, { pdf, pngEmail: pe, pngWhatsapp: pw });
  const a = await files.getFile(e1, 'pdf');
  assert.ok(Buffer.isBuffer(a.conteudo));
  assert.ok(a.conteudo.equals(pdf));
  assert.ok(a.gerado_em);
  assert.ok((await files.getFile(e1, 'png_email')).conteudo.equals(pe));
  assert.ok((await files.getFile(e1, 'png_whatsapp')).conteudo.equals(pw));
});

test('getFile: ausente ou outra edição devolve null; tipo inválido devolve null', async () => {
  assert.equal(await files.getFile(e2, 'pdf'), null);
  assert.equal(await files.getFile(e1, 'exe'), null);
});

test('saveFiles de novo substitui (uma linha por tipo)', async () => {
  const novo = Buffer.from('%PDF-novo');
  await files.saveFiles(e1, uid, { pdf: novo, pngEmail: bin(10), pngWhatsapp: bin(10) });
  assert.ok((await files.getFile(e1, 'pdf')).conteudo.equals(novo));
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM arquivos_publicados WHERE edicao_id = ?', [e1]);
  assert.equal(Number(c.n), 3);
});

test('saveFiles é atômico: falha no meio não deixa estado parcial nem apaga o anterior', async () => {
  const antes = (await files.getFile(e1, 'pdf')).conteudo;
  await assert.rejects(files.saveFiles(e1, uid, { pdf: Buffer.from('x'), pngEmail: null, pngWhatsapp: bin(5) }));
  assert.ok((await files.getFile(e1, 'pdf')).conteudo.equals(antes));
});

test('deleteFiles limpa só a edição pedida', async () => {
  await files.saveFiles(e2, uid, { pdf: bin(5), pngEmail: bin(5), pngWhatsapp: bin(5) });
  await files.deleteFiles(e1);
  assert.equal(await files.getFile(e1, 'pdf'), null);
  assert.ok(await files.getFile(e2, 'pdf'));
});

test('settings: padrões, upsert, JSON de cores e tipos', async () => {
  const d = await settings.getSettings();
  assert.equal(d.emailTi, 'informatica@senar-rs.com.br');
  assert.equal(d.rodape, 'TI SENAR-RS');
  assert.equal(d.pisoReducao, 0.75);
  assert.equal(d.subtitulo, 'Avisos rápidos, melhorias e orientações para as equipes do SENAR-RS.');
  assert.deepEqual(d.cores, {});
  await settings.setSettings({ emailTi: 'a@b.com', pisoReducao: 0.6, cores: { '--teal': '#112233' } });
  await settings.setSettings({ rodape: 'Outro' });
  const s = await settings.getSettings();
  assert.equal(s.emailTi, 'a@b.com');
  assert.equal(s.rodape, 'Outro');
  assert.equal(s.pisoReducao, 0.6);
  assert.deepEqual(s.cores, { '--teal': '#112233' });
});

test('settings: valor corrompido no banco cai no padrão', async () => {
  await pool.query("REPLACE INTO configuracoes (chave, valor) VALUES ('pisoReducao','abc'), ('cores','{quebrado')");
  const s = await settings.getSettings();
  assert.equal(s.pisoReducao, 0.75);
  assert.deepEqual(s.cores, {});
});

test('logo: nulo, grava e substitui (id=1)', async () => {
  assert.equal(await settings.getLogo(), null);
  const a = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), bin(100)]);
  await settings.setLogo(a, 'image/png');
  const l = await settings.getLogo();
  assert.ok(l.buffer.equals(a));
  assert.equal(l.mime, 'image/png');
  const b = Buffer.from([0xff, 0xd8, 0xff, 1, 2]);
  await settings.setLogo(b, 'image/jpeg');
  assert.equal((await settings.getLogo()).mime, 'image/jpeg');
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM logo');
  assert.equal(Number(c.n), 1);
});
