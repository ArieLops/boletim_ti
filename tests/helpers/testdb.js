const mysql = require('mysql2/promise');
const { migrate } = require('../../src/db/migrate');

// Dropa e recria o banco de teste; por padrão já roda as migrações.
async function resetTestDb({ migrate: runMigrations = true } = {}) {
  const database = process.env.BOLETIM_TEST_DB || 'boletim_test';
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

module.exports = { resetTestDb };
