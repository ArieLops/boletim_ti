const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { makeUsersRepo } = require('./repos/users');
const { loadUser, csrf } = require('./auth/middleware');
const { authRoutes } = require('./routes/auth');
const { usersRoutes } = require('./routes/users');
const { editionsRoutes } = require('./routes/editions');
const { exportsRoutes } = require('./routes/exports');
const { settingsRoutes } = require('./routes/settings');
const { screensRoutes } = require('./routes/screens');
const { makeEditionsRepo } = require('./repos/editions');
const { makeHistoryRepo } = require('./repos/history');
const { makeFilesRepo } = require('./repos/files');
const { makeSettingsRepo } = require('./repos/settings');

// Opções ausentes caem em `config` (que valida o .env); testes passam tudo explicitamente.
function createApp({ pool, exporter, cookieSecure, sessionSecret, sessionHours } = {}) {
  const needsConfig = cookieSecure === undefined || sessionSecret === undefined || sessionHours === undefined;
  const cfg = needsConfig ? require('./config').config : {};
  const secure = cookieSecure ?? cfg.cookieSecure;
  const secret = sessionSecret ?? cfg.sessionSecret;
  const hours = sessionHours ?? cfg.sessionHours;
  const maxAge = hours * 3600 * 1000;

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  // O pool é do chamador: o store não o encerra no close().
  const store = new MySQLStore({ expiration: maxAge }, pool);
  app.locals.pool = pool;
  app.locals.exporter = exporter;
  app.locals.users = makeUsersRepo(pool);
  app.locals.editions = makeEditionsRepo(pool);
  app.locals.history = makeHistoryRepo(pool);
  app.locals.files = makeFilesRepo(pool);
  app.locals.settings = makeSettingsRepo(pool);
  // O store arma um setInterval ao ficar pronto; fechar antes disso deixaria o timer vivo (processo não sai).
  app.locals.close = async () => {
    let timer;
    const limite = new Promise((resolve) => { timer = setTimeout(resolve, 3000); });
    await Promise.race([store.onReady().catch(() => {}), limite]);
    clearTimeout(timer);
    return store.close();
  };

  // Saúde para monitoramento: sem sessão/login, ping barato no banco, sem detalhes no erro.
  app.get('/saude', async (req, res) => {
    try {
      await app.locals.pool.query('SELECT 1');
      res.json({ ok: true });
    } catch (err) {
      console.error('saude: falha no banco:', err.code || err.message);
      res.status(503).json({ ok: false });
    }
  });

  // Estáticos (css/js das telas) antes da sessão: não criam sessão nem exigem login.
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'sid',
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge },
    })
  );
  app.use(csrf);
  app.use(loadUser);
  app.use(authRoutes());
  app.use(usersRoutes());
  app.use(editionsRoutes());
  app.use(exportsRoutes());
  app.use(settingsRoutes());
  app.use(screensRoutes());

  // Tratador geral: corpo malformado/grande vira 400/413 em JSON; o resto 500 sem expor detalhes.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'corpo da requisição grande demais' });
    if (err.status === 400 || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return res.status(400).json({ erro: 'requisição inválida' });
    console.error(err);
    res.status(500).json({ erro: 'erro interno' });
  });

  return app;
}

module.exports = { createApp };
