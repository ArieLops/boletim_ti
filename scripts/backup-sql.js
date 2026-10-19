// Backup lógico (somente leitura) do banco do Comunicado Semanal: escreve um .sql no stdout.
// Usa DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME do ambiente e o mysql2 do app (rode dentro do contêiner).
const mysql = require('mysql2/promise');

// Colunas JSON chegam como objeto/array: serializa (o escape do mysql2 os trataria como pares chave = valor).
const esc = (v) => mysql.escape(v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date) ? JSON.stringify(v) : v);
const out = (s) => new Promise((ok) => (process.stdout.write(s) ? ok() : process.stdout.once('drain', ok)));
const id = (n) => '`' + String(n).replace(/`/g, '``') + '`';

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, charset: 'utf8mb4',
  });
  await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  await out(`-- Backup logico de ${process.env.DB_NAME} em ${new Date().toISOString()}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n`);
  const [tabs] = await c.query("SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  let total = 0;
  for (const { n } of tabs) {
    const [[cr]] = await c.query(`SHOW CREATE TABLE ${id(n)}`);
    await out(`DROP TABLE IF EXISTS ${id(n)};\n${cr['Create Table']};\n\n`);
    if (n === 'sessions') continue; // sessoes sao descartaveis: so a estrutura
    const [rows] = await c.query(`SELECT * FROM ${id(n)}`);
    const cols = rows.length ? Object.keys(rows[0]).map(id).join(',') : '';
    for (let i = 0; i < rows.length; i += 100) {
      const vals = rows.slice(i, i + 100).map((r) => '(' + Object.values(r).map(esc).join(',') + ')').join(',\n');
      await out(`INSERT INTO ${id(n)} (${cols}) VALUES\n${vals};\n`);
    }
    total += rows.length;
    process.stderr.write(`${n}: ${rows.length} linhas\n`);
  }
  await out('\nSET FOREIGN_KEY_CHECKS=1;\n-- Backup completo\n');
  await c.query('COMMIT');
  await c.end();
  process.stderr.write(`OK: ${tabs.length} tabelas, ${total} linhas\n`);
})().catch((e) => { process.stderr.write('FALHA: ' + (e.code || e.message) + '\n'); process.exit(1); });
