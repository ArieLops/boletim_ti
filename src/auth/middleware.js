const crypto = require('node:crypto');

// Contrato para chamadas fetch: requisições "de API" recebem erros JSON (401/403) em vez de
// redirecionamentos/HTML. É API se o caminho começa com /api/, ou Accept inclui application/json,
// ou Content-Type é application/json. Os fetch do front-end (Task 7) DEVEM enviar
// `Accept: application/json`. Navegação normal (páginas, prévia, links de download) mantém redirect/texto.
function wantsJson(req) {
  const url = req.originalUrl || req.url || '';
  return (
    url.startsWith('/api/') ||
    String(req.get('accept') || '').includes('application/json') ||
    Boolean(req.is && req.is('application/json'))
  );
}

// Carrega o usuário da sessão a cada requisição (usuário desativado perde o acesso).
async function loadUser(req, res, next) {
  const id = req.session && req.session.userId;
  if (!id) return next();
  const u = await req.app.locals.users.getById(id);
  if (!u || !u.ativo) {
    return req.session.destroy(() =>
      wantsJson(req) ? res.status(401).json({ erro: 'sessão expirada' }) : res.redirect('/login')
    );
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
  if (!req.user) return wantsJson(req) ? res.status(401).json({ erro: 'sessão expirada' }) : res.redirect('/login');
  if (req.user.trocar_senha) {
    return wantsJson(req) ? res.status(403).json({ erro: 'troca de senha obrigatória' }) : res.redirect('/trocar-senha');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.perfil !== 'administrador') {
    return wantsJson(req) ? res.status(403).json({ erro: 'acesso restrito a administradores' }) : res.status(403).send('Acesso negado');
  }
  next();
}

// CSRF simples por sessão: token em req.session, enviado no campo `_csrf` do corpo (formulários)
// ou no cabeçalho `X-CSRF-Token` (fetch JSON e upload binário).
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const doCorpo = req.body && !Array.isArray(req.body) ? req.body._csrf : undefined;
  const enviado = Buffer.from(String(req.get('x-csrf-token') || doCorpo || ''));
  const esperado = Buffer.from(req.session.csrf);
  if (enviado.length !== esperado.length || !crypto.timingSafeEqual(enviado, esperado)) {
    if (wantsJson(req)) {
      // Sem sessão autenticada (expirada) o cliente precisa logar de novo: 401, não 403.
      return req.session.userId
        ? res.status(403).json({ erro: 'token CSRF inválido' })
        : res.status(401).json({ erro: 'sessão expirada' });
    }
    return res.status(403).send('Requisição inválida (token CSRF)');
  }
  next();
}

module.exports = { loadUser, requireSession, requireLogin, requireAdmin, csrf };
