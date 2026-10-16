const fs = require('node:fs/promises');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Divide o arquivo em comandos (cada um termina com ";" no fim da linha).
function statements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Aplica as migrações ausentes (ordem alfabética), uma transação por arquivo.
// Obs.: DDL faz commit implícito no MySQL/MariaDB; a transação garante ao
// menos o registro atômico em schema_migrations junto de eventuais DML.
async function migrate(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       nome VARCHAR(255) NOT NULL PRIMARY KEY,
       aplicada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [rows] = await pool.query('SELECT nome FROM schema_migrations');
  const feitas = new Set(rows.map((r) => r.nome));
  const arquivos = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const aplicadas = [];
  for (const arquivo of arquivos) {
    if (feitas.has(arquivo)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, arquivo), 'utf8');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements(sql)) await conn.query(stmt);
      await conn.query('INSERT INTO schema_migrations (nome) VALUES (?)', [arquivo]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw new Error(`Falha na migração ${arquivo}: ${err.message}`);
    } finally {
      conn.release();
    }
    aplicadas.push(arquivo);
  }
  return aplicadas;
}

module.exports = { migrate };
