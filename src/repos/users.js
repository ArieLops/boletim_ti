const { hashPassword, checkPassword, dummyHash } = require('../auth/passwords');

const PERFIS = ['editor', 'administrador'];

function makeUsersRepo(pool) {
  async function createUser({ nome, login, senha, perfil }) {
    if (!PERFIS.includes(perfil)) throw new Error('Perfil inválido');
    const hash = await hashPassword(senha);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nome, login, senha_hash, perfil, trocar_senha) VALUES (?, ?, ?, ?, 1)',
      [nome, login, hash, perfil]
    );
    return r.insertId;
  }

  async function verifyLogin(login, senha) {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE login = ?', [login]);
    const u = rows[0];
    const ok = await checkPassword(senha, u ? u.senha_hash : await dummyHash());
    if (!u || !ok || !u.ativo) return null;
    return u;
  }

  async function getById(id) {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async function setPassword(id, senha) {
    const hash = await hashPassword(senha);
    await pool.query('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', [hash, id]);
  }

  // Senha provisória definida por administrador: obriga a troca no próximo login.
  async function setTemporaryPassword(id, senha) {
    const hash = await hashPassword(senha);
    await pool.query('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1 WHERE id = ?', [hash, id]);
  }

  async function setActive(id, ativo) {
    await pool.query('UPDATE usuarios SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  }

  async function listUsers() {
    const [rows] = await pool.query(
      'SELECT id, nome, login, perfil, ativo, trocar_senha, criado_em FROM usuarios ORDER BY nome'
    );
    return rows;
  }

  return { createUser, verifyLogin, getById, setPassword, setTemporaryPassword, setActive, listUsers };
}

let defaultRepo;
// Funções ligadas ao pool da aplicação (getPool), criadas sob demanda.
function lazy(nome) {
  return (...args) => {
    if (!defaultRepo) defaultRepo = makeUsersRepo(require('../db/pool').getPool());
    return defaultRepo[nome](...args);
  };
}

module.exports = {
  PERFIS,
  makeUsersRepo,
  createUser: lazy('createUser'),
  verifyLogin: lazy('verifyLogin'),
  setPassword: lazy('setPassword'),
  setActive: lazy('setActive'),
  listUsers: lazy('listUsers'),
};
