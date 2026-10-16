const bcrypt = require('bcryptjs');

// Lê o custo direto do ambiente (mesma regra de config.bcryptCost) para não
// exigir as demais variáveis do .env em quem só precisa de hash.
function cost() {
  return Number(process.env.BCRYPT_COST) || 12;
}

function hashPassword(senha) {
  return bcrypt.hash(senha, cost());
}

function checkPassword(senha, hash) {
  return bcrypt.compare(senha, hash);
}

// Hash descartável com o MESMO custo dos hashes reais (comparação com login
// inexistente leva o mesmo tempo). Em cache por custo.
const dummies = new Map();
function dummyHash() {
  const c = cost();
  if (!dummies.has(c)) {
    dummies.set(c, hashPassword(require('node:crypto').randomBytes(16).toString('hex')));
  }
  return dummies.get(c);
}

module.exports = { hashPassword, checkPassword, dummyHash };
