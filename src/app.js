const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { makeUsersRepo } = require('./repos/users');
const { loadUser, requireLogin, csrf } = require('./auth/middleware');
const { authRoutes } = require('./routes/auth');
const { usersRoutes } = require('./routes/users');
const { editionsRoutes } = require('./routes/editions');
const { exportsRoutes } = require('./routes/exports');
const { settingsRoutes } = require('./routes/settings');
const { makeEditionsRepo } = require('./repos/editions');
const { makeHistoryRepo } = require('./repos/history');
const { makeFilesRepo } = require('./repos/files');
const { makeSettingsRepo } = require('./repos/settings');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

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
  app.locals.close = () => store.close();

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

  // Provisória: a Task 7 substitui pela tela inicial.
  app.get('/', requireLogin, (req, res) => {
    res.type('html').send(
      '<!doctype html><meta charset="utf-8"><title>Comunicado Semanal</title>' +
        `<p>Olá, ${esc(req.user.nome)}.</p>` +
        '<form method="post" action="/logout">' +
        `<input type="hidden" name="_csrf" value="${esc(res.locals.csrfToken)}">` +
        '<button>Sair</button></form>'
    );
  });

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
