const mysql = require('mysql2/promise');
const { migrate } = require('../../src/db/migrate');

// O helper DROPa o banco: só aceita nomes boletim_test* e nunca o banco configurado para a aplicação.
function assertSafeTestDbName(nome, env = process.env) {
  if (typeof nome !== 'string' || !/^boletim_test[a-z0-9_]*$/.test(nome)) {
    throw new Error(`BOLETIM_TEST_DB inválido (${JSON.stringify(nome)}): o nome deve começar com "boletim_test" (letras minúsculas, dígitos e _).`);
  }
  if (env.DB_NAME && env.DB_NAME === nome) {
    throw new Error(`BOLETIM_TEST_DB (${nome}) é igual ao DB_NAME da aplicação; recusando apagar esse banco.`);
  }
  return nome;
}

// Dropa e recria o banco de teste; por padrão já roda as migrações.
async function resetTestDb({ migrate: runMigrations = true } = {}) {
  const database = assertSafeTestDbName(process.env.BOLETIM_TEST_DB || 'boletim_test');
  const conn = {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT) || 3306,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
  };
  const admin = await mysql.createConnection(conn);
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await admin.end();
  }
  const pool = mysql.createPool({ ...conn, database, connectionLimit: 5 });
  if (runMigrations) await migrate(pool);
  return pool;
}

module.exports = { resetTestDb, assertSafeTestDbName };
