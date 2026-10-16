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
const { buildServer } = require('./bootstrap');

async function main() {
  const pool = getPool();
  await migrate(pool);
  const exporter = createExporter({ renderHtml: renderEdition });
  const { app, close } = buildServer({ config, pool, exporter });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Comunicado Semanal ouvindo em http://${config.host}:${config.port} (Node ${process.version})`);
  });
  server.on('error', (e) => {
    console.error(`FATAL: não foi possível escutar em ${config.host}:${config.port}: ${e.message}`);
    process.exit(1);
  });

  let encerrando = false;
  async function encerrar(sinal) {
    if (encerrando) return;
    encerrando = true;
    console.log(`${sinal} recebido: encerrando...`);
    setTimeout(() => {
      console.error('Encerramento excedeu 10 s: forçando saída.');
      process.exit(1);
    }, 10000).unref();
    server.close(); // para de aceitar conexões
    server.closeIdleConnections?.();
    try {
      await close();
      await exporter.close();
      await closePool();
    } catch (e) {
      console.error('Erro ao encerrar:', e.message);
      process.exit(1);
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

main().catch((e) => {
  console.error(`FATAL: falha ao iniciar: ${e.message}`);
  process.exit(1);
});
