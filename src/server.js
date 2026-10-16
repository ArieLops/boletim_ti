// Entrada de produção (npm start). Lê o ambiente (systemd EnvironmentFile ou --env-file), migra o
// banco, abre o exportador e escuta SOMENTE em HOST (padrão 127.0.0.1): o nginx é a porta de entrada.
const { loadConfig } = require('./config');

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}

const { getPool, closePool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createExporter } = require('./export/exporter');
const { renderEdition } = require('./render/renderEdition');
const { buildServer, criarEncerramento } = require('./bootstrap');

async function main() {
  const pool = getPool();
  await migrate(pool);
  const exporter = createExporter({ renderHtml: renderEdition });
  const { app } = buildServer({ config, pool, exporter });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Comunicado Semanal ouvindo em http://${config.host}:${config.port} (Node ${process.version})`);
  });
  server.on('error', (e) => {
    console.error(`FATAL: não foi possível escutar em ${config.host}:${config.port}: ${e.message}`);
    process.exit(1);
  });

  const encerrar = criarEncerramento({ server, app, exporter, closePool, timeoutMs: 10000 });
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

main().catch((e) => {
  console.error(`FATAL: falha ao iniciar: ${e.message}`);
  process.exit(1);
});
