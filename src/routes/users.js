const express = require('express');
const { requireLogin, requireAdmin } = require('../auth/middleware');
const { PERFIS } = require('../repos/users');
const { MIN_SENHA } = require('./auth');

function usersRoutes() {
  const r = express.Router();
  r.use('/usuarios', requireLogin, requireAdmin);

  async function render(req, res, status = 200, erro = null) {
    const usuarios = await req.app.locals.users.listUsers();
    res.status(status).render('usuarios', { usuarios, erro, perfis: PERFIS });
  }

  r.get('/usuarios', (req, res) => render(req, res));

  r.post('/usuarios', async (req, res) => {
    const b = req.body || {};
    const nome = String(b.nome || '').trim();
    const login = String(b.login || '').trim();
    const senha = String(b.senha || '');
    const perfil = String(b.perfil || '');
    if (!nome || !login) return render(req, res, 400, 'Informe nome e login.');
    if (!PERFIS.includes(perfil)) return render(req, res, 400, 'Perfil inválido.');
    if (senha.length < MIN_SENHA) return render(req, res, 400, `A senha deve ter pelo menos ${MIN_SENHA} caracteres.`);
    try {
      await req.app.locals.users.createUser({ nome, login, senha, perfil });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return render(req, res, 400, 'Já existe um usuário com esse login.');
      throw e;
    }
    res.redirect(req.app.locals.url('/usuarios'));
  });

  r.post('/usuarios/:id/senha', async (req, res) => {
    const id = Number(req.params.id);
    const senha = String((req.body && req.body.senha) || '');
    if (!Number.isInteger(id) || !(await req.app.locals.users.getById(id))) {
      return res.status(404).send('Usuário não encontrado');
    }
    if (senha.length < MIN_SENHA) return render(req, res, 400, `A senha deve ter pelo menos ${MIN_SENHA} caracteres.`);
    await req.app.locals.users.setTemporaryPassword(id, senha);
    res.redirect(req.app.locals.url('/usuarios'));
  });

  r.post('/usuarios/:id/ativo', async (req, res) => {
    const id = Number(req.params.id);
    const ativo = String((req.body && req.body.ativo) || '') === '1';
    if (!Number.isInteger(id) || !(await req.app.locals.users.getById(id))) {
      return res.status(404).send('Usuário não encontrado');
    }
    if (!ativo && id === req.user.id) return render(req, res, 400, 'Você não pode desativar o próprio usuário.');
    await req.app.locals.users.setActive(id, ativo);
    res.redirect(req.app.locals.url('/usuarios'));
  });

  return r;
}

module.exports = { usersRoutes };
