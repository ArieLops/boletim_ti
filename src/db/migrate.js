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

// IMPORTANTE: todo arquivo de migração DEVE ser re-executável (idempotente,
// ex.: CREATE TABLE IF NOT EXISTS). DDL no MySQL/MariaDB faz commit implícito,
// então uma falha no meio do arquivo deixa objetos criados sem registro em
// schema_migrations; a próxima execução reaplica o arquivo inteiro.
//
// Um lock (GET_LOCK) impede que dois processos migrem ao mesmo tempo.
const LOCK_NAME = 'boletim_migrate';
const LOCK_TIMEOUT_S = 30;

async function migrate(pool) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [LOCK_NAME, LOCK_TIMEOUT_S]);
    if (lock.ok !== 1) {
      throw new Error(`Não foi possível obter o lock de migração '${LOCK_NAME}' em ${LOCK_TIMEOUT_S}s`);
    }
    locked = true;

    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         nome VARCHAR(255) NOT NULL PRIMARY KEY,
         aplicada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const [rows] = await conn.query('SELECT nome FROM schema_migrations');
    const feitas = new Set(rows.map((r) => r.nome));
    const arquivos = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const aplicadas = [];
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, arquivo), 'utf8');
      try {
        await conn.beginTransaction();
        for (const stmt of statements(sql)) await conn.query(stmt);
        await conn.query('INSERT INTO schema_migrations (nome) VALUES (?)', [arquivo]);
        await conn.commit();
      } catch (err) {
        try { await conn.rollback(); } catch { /* não mascara o erro original */ }
        throw new Error(`Falha na migração ${arquivo}: ${err.message}`);
      }
      aplicadas.push(arquivo);
    }
    return aplicadas;
  } finally {
    if (locked) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch { /* conexão será liberada */ }
    }
    conn.release();
  }
}

module.exports = { migrate };
