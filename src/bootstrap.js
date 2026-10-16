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

module.exports = { buildServer };
