const express = require('express');
const { createThrottle } = require('../auth/throttle');
const { requireSession } = require('../auth/middleware');

const MSG_INVALIDO = 'Usuário ou senha inválidos';
const MSG_BLOQUEADO = 'Muitas tentativas. Conta temporariamente bloqueada; tente novamente em alguns minutos.';
const MIN_SENHA = 8;

function authRoutes({ throttle = createThrottle() } = {}) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { erro: null });
  });

  r.post('/login', async (req, res) => {
    const login = String((req.body && req.body.login) || '').trim();
    const senha = String((req.body && req.body.senha) || '');
    const chave = `${login.toLowerCase()}|${req.ip}`;
    if (throttle.bloqueado(chave)) return res.status(429).render('login', { erro: MSG_BLOQUEADO });
    const u = login && senha ? await req.app.locals.users.verifyLogin(login, senha) : null;
    if (!u) {
      throttle.registrarFalha(chave);
      return res.status(401).render('login', { erro: MSG_INVALIDO });
    }
    throttle.limpar(chave);
    // Nova sessão após autenticar (evita fixação de sessão); o token CSRF também é renovado.
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Erro interno');
      req.session.userId = u.id;
      req.session.save((e2) => {
        if (e2) return res.status(500).send('Erro interno');
        res.redirect(u.trocar_senha ? '/trocar-senha' : '/');
      });
    });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('sid');
      res.redirect('/login');
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
    res.redirect('/');
  });

  return r;
}

module.exports = { authRoutes, MIN_SENHA };
