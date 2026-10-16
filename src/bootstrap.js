// Montagem testável do servidor (sem abrir porta): app + encerramento ordenado dos recursos.
const { createApp } = require('./app');

// O pool e o exportador são do chamador (server.js os cria e os encerra); close() libera o store de sessão.
function buildServer({ config, pool, exporter }) {
  const app = createApp({
    pool,
    exporter,
    cookieSecure: config.cookieSecure,
    sessionSecret: config.sessionSecret,
    sessionHours: config.sessionHours,
  });
  return { app, close: () => app.locals.close() };
}

// Encerramento ordenado (SIGTERM/SIGINT). Primeiro para de aceitar conexões e ESPERA as requisições em
// andamento (ex.: uma publicação durante `systemctl restart`); só então fecha store, exportador e pool.
// `timeoutMs` é o guarda: se algo não terminar, força a saída com código 1. Chamadas repetidas são ignoradas.
function criarEncerramento({ server, app, exporter, closePool, timeoutMs = 10000, exit = (c) => process.exit(c), log = console }) {
  let emCurso = null;
  return function encerrar(sinal) {
    if (emCurso) return emCurso;
    log.log(`${sinal} recebido: encerrando...`);
    emCurso = new Promise((resolve) => {
      const guarda = setTimeout(() => {
        log.error(`Encerramento excedeu ${timeoutMs / 1000} s: forçando saída.`);
        exit(1);
        resolve();
      }, timeoutMs);
      if (guarda.unref) guarda.unref();
      (async () => {
        await new Promise((ok) => {
          server.close(() => ok()); // callback só quando as conexões terminarem
          server.closeIdleConnections?.();
        });
        await app.locals.close();
        await exporter.close();
        await closePool();
        return 0;
      })().catch((e) => {
        log.error('Erro ao encerrar:', e.message);
        return 1;
      }).then((codigo) => {
        clearTimeout(guarda);
        exit(codigo);
        resolve();
      });
    });
    return emCurso;
  };
}

module.exports = { buildServer, criarEncerramento };
