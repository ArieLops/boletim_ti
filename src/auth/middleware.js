const crypto = require('node:crypto');

// Carrega o usuário da sessão a cada requisição (usuário desativado perde o acesso).
async function loadUser(req, res, next) {
  const id = req.session && req.session.userId;
  if (!id) return next();
  const u = await req.app.locals.users.getById(id);
  if (!u || !u.ativo) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  req.user = u;
  res.locals.user = u;
  next();
}

// Exige apenas sessão válida (usada na própria tela de troca de senha).
function requireSession(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.trocar_senha) return res.redirect('/trocar-senha');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.perfil !== 'administrador') return res.status(403).send('Acesso negado');
  next();
}

// CSRF simples por sessão: token em req.session, campo oculto `_csrf` nos POSTs.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const enviado = Buffer.from(String((req.body && req.body._csrf) || ''));
  const esperado = Buffer.from(req.session.csrf);
  if (enviado.length !== esperado.length || !crypto.timingSafeEqual(enviado, esperado)) {
    return res.status(403).send('Requisição inválida (token CSRF)');
  }
  next();
}

module.exports = { loadUser, requireSession, requireLogin, requireAdmin, csrf };
