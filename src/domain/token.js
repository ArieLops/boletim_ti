const crypto = require('node:crypto');

// Token do link público: 16 bytes aleatórios (128 bits) em base64url = 22 caracteres [A-Za-z0-9_-].
function novoToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Sem a flag "m", "$" só casa no fim da entrada (uma quebra de linha final é rejeitada).
function tokenValido(valor) {
  return typeof valor === 'string' && /^[A-Za-z0-9_-]{22}$/.test(valor);
}

module.exports = { novoToken, tokenValido };
