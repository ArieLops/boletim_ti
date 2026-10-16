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

module.exports = { hashPassword, checkPassword };
