// SOMENTE DESENVOLVIMENTO LOCAL (teste manual da interface). Não use em produção: o servidor de
// produção é src/server.js (Task 8), que lê o .env.
//
// O que faz: cria o app com o exportador real (Chromium/Edge), usando o banco local descartável
// `boletim_dev` em 127.0.0.1:3307 (mesmo servidor MariaDB dos testes), roda as migrações, cria um
// administrador de teste se a tabela de usuários estiver vazia e escuta em http://localhost:3100.
//
// Login do administrador de desenvolvimento (constantes locais, sem valor fora desta máquina):
//   usuário: dev-admin    senha: dev-admin-123
//   (trocar_senha = 0: entra direto, sem pedir troca de senha)
//
// Uso: npm run dev     (ou: node --env-file=.env.test scripts/dev-server.js)
const mysql = require('mysql2/promise');
const { migrate } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const { createExporter } = require('../src/export/exporter');
const { renderEdition } = require('../src/render/renderEdition');
const { makeUsersRepo } = require('../src/repos/users');

const DB = { host: '127.0.0.1', port: 3307, user: 'boletim', password: 'boletim_dev', database: 'boletim_dev' };
const ADMIN = { nome: 'Administrador Dev', login: 'dev-admin', senha: 'dev-admin-123' };
const PORTA = 3100;

async function main() {
  const { database, ...semBanco } = DB;
  const admin = await mysql.createConnection(semBanco);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const pool = mysql.createPool({ ...DB, connectionLimit: 10, charset: 'utf8mb4' });
  await migrate(pool);

  const users = makeUsersRepo(pool);
  if ((await users.listUsers()).length === 0) {
    const id = await users.createUser({ ...ADMIN, perfil: 'administrador' });
    await users.setPassword(id, ADMIN.senha); // zera trocar_senha
    console.log(`Administrador de desenvolvimento criado: ${ADMIN.login} / ${ADMIN.senha}`);
  }

  const exporter = createExporter({ renderHtml: renderEdition });
  const app = createApp({ pool, exporter, cookieSecure: false, sessionSecret: 'segredo-somente-desenvolvimento', sessionHours: 8 });
  const server = app.listen(PORTA, () => console.log(`Servidor de desenvolvimento em http://localhost:${PORTA}`));

  let encerrando = false;
  async function encerrar() {
    if (encerrando) return;
    encerrando = true;
    server.close();
    await exporter.close().catch(() => {});
    await app.locals.close();
    await pool.end().catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
