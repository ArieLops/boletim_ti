const mysql = require('mysql2/promise');
const { config } = require('../config');

let pool;

function getPool() {
  if (!pool) {
    const { host, port, user, password, database } = config.db;
    pool = mysql.createPool({
      host, port, user, password, database,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

module.exports = { getPool, closePool };
