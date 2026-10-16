const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { makeUsersRepo } = require('./repos/users');
const { loadUser, csrf, wantsJson } = require('./auth/middleware');
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
const { normalizeBasePath, makeUrl } = require('./base-path');

// Opções ausentes caem em `config` (que valida o .env); testes passam tudo explicitamente.
function createApp({ pool, exporter, cookieSecure, sessionSecret, sessionHours, basePath } = {}) {
  const needsConfig = cookieSecure === undefined || sessionSecret === undefined || sessionHours === undefined;
  const cfg = needsConfig ? require('./config').config : {};
  const secure = cookieSecure ?? cfg.cookieSecure;
  const secret = sessionSecret ?? cfg.sessionSecret;
  const hours = sessionHours ?? cfg.sessionHours;
  const maxAge = hours * 3600 * 1000;
  // Prefixo de publicação (ex.: /boletim_ti). Sem a opção, só a config carregada acima pode fornecê-lo.
  const base = normalizeBasePath(basePath ?? cfg.basePath);
  const url = makeUrl(base);

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');
  // O mount em `base` é casado pelo roteador do app: sem isto /BOLETIM_TI/... seria atendido (ver o Router abaixo).
  app.enable('case sensitive routing');

  // O pool é do chamador: o store não o encerra no close().
  const store = new MySQLStore({ expiration: maxAge }, pool);
  app.locals.basePath = base;
  app.locals.u = url; // views renderizadas fora do Router (tratador de erros) também têm o helper
  app.locals.url = url;
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
  // Fica na raiz (healthcheck do Docker) e também sob o prefixo; ambos antes da sessão.
  const saude = async (req, res) => {
    try {
      await app.locals.pool.query('SELECT 1');
      res.json({ ok: true });
    } catch (err) {
      console.error('saude: falha no banco:', err.code || err.message);
      res.status(503).json({ ok: false });
    }
  };
  app.get('/saude', saude);
  if (base) app.get(base + '/saude', saude);

  // Tudo que exige sessão vive em um único Router, montado em base || '/'. Fora do prefixo nada disso
  // executa (nem a sessão): cai no 404 simples abaixo.
  // A proteção contra /BOLETIM_TI/... é `app.enable('case sensitive routing')` acima (o mount em `base` é casado
  // pelo roteador do app); uma opção no Router não teria efeito sobre isso.
  const root = express.Router();
  root.use((req, res, next) => {
    res.locals.u = url;
    res.locals.basePath = base;
    next();
  });
  // Estáticos (css/js das telas) antes da sessão: não criam sessão nem exigem login.
  root.use(express.static(path.join(__dirname, 'public')));
  root.use(express.urlencoded({ extended: false }));
  root.use(express.json({ limit: '1mb' }));
  root.use(
    session({
      name: 'boletim.sid', // distinto de 'sid'/'PHPSESSID' de outras aplicações no mesmo host
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge, path: base || '/' },
    })
  );
  root.use(csrf);
  root.use(loadUser);
  root.use(authRoutes());
  root.use(usersRoutes());
  root.use(editionsRoutes());
  root.use(exportsRoutes());
  root.use(settingsRoutes());
  root.use(screensRoutes());
  app.use(base || '/', root);

  // Qualquer outra coisa (fora do prefixo ou rota desconhecida): texto simples, sem detalhes.
  app.use((req, res) => res.status(404).type('text').send('Não encontrado'));

  // Tratador geral: corpo malformado/grande vira 400/413 em JSON; o resto 500 sem expor detalhes.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'corpo da requisição grande demais' });
    if (err.status === 400 || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return res.status(400).json({ erro: 'requisição inválida' });
    console.error(err);
    if (wantsJson(req)) return res.status(500).json({ erro: 'erro interno' });
    // Página HTML: tela de erro genérica (sem detalhes); se nem ela renderizar, texto simples.
    res.status(500).render(
      'erro',
      { titulo: 'Erro interno', mensagem: 'Algo deu errado do nosso lado. Tente novamente; se continuar, avise a TI.' },
      (e, html) => (e ? res.type('text').send('Erro interno') : res.send(html))
    );
  });

  return app;
}

module.exports = { createApp };
