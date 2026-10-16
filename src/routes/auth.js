const express = require('express');
const { createThrottle } = require('../auth/throttle');
const { requireSession } = require('../auth/middleware');

const MSG_INVALIDO = 'Usuário ou senha inválidos';
const MSG_BLOQUEADO = 'Muitas tentativas. Conta temporariamente bloqueada; tente novamente em alguns minutos.';
const MIN_SENHA = 8;

// Forma canônica do login para a chave do throttle: a collation do banco ignora
// acento/caixa/espaços finais, então as variantes precisam cair no mesmo balde.
function loginCanonico(login) {
  return login.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function authRoutes({ throttle = createThrottle() } = {}) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(req.app.locals.url('/'));
    res.render('login', { erro: null });
  });

  r.post('/login', async (req, res) => {
    const login = String((req.body && req.body.login) || '').trim();
    const senha = String((req.body && req.body.senha) || '');
    const chave = `${loginCanonico(login)}|${req.ip}`;
    if (throttle.bloqueado(chave)) return res.status(429).render('login', { erro: MSG_BLOQUEADO });
    // A tentativa é contada ANTES do await (evita burlar o limite com requisições
    // paralelas); em caso de sucesso a chave é limpa.
    throttle.registrarFalha(chave);
    const u = login && senha ? await req.app.locals.users.verifyLogin(login, senha) : null;
    if (!u) {
      return res.status(401).render('login', { erro: MSG_INVALIDO });
    }
    throttle.limpar(chave);
    // Nova sessão após autenticar (evita fixação de sessão); o token CSRF também é renovado.
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Erro interno');
      req.session.userId = u.id;
      req.session.save((e2) => {
        if (e2) return res.status(500).send('Erro interno');
        res.redirect(req.app.locals.url(u.trocar_senha ? '/trocar-senha' : '/'));
      });
    });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('boletim.sid', { path: req.app.locals.basePath || '/' });
      res.redirect(req.app.locals.url('/login'));
    });
  });

  r.get('/trocar-senha', requireSession, (req, res) => {
    res.render('trocar-senha', { erro: null });
  });

  r.post('/trocar-senha', requireSession, async (req, res) => {
    const senha = String((req.body && req.body.senha) || '');
    const confirmacao = String((req.body && req.body.confirmacao) || '');
    let erro = null;
    if (senha.length < MIN_SENHA) erro = `A senha deve ter pelo menos ${MIN_SENHA} caracteres.`;
    else if (senha !== confirmacao) erro = 'A confirmação não confere com a senha.';
    if (erro) return res.status(400).render('trocar-senha', { erro });
    await req.app.locals.users.setPassword(req.user.id, senha);
    res.redirect(req.app.locals.url('/'));
  });

  return r;
}

module.exports = { authRoutes, MIN_SENHA };
