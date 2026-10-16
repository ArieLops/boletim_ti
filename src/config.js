// A validação é feita em loadConfig(); `config` é construído sob demanda
// (getter) para que testes que não definem SESSION_SECRET/DB_* possam
// importar módulos sem que o import quebre.
const { normalizeBasePath } = require('./base-path');

function loadConfig(env = process.env) {
  const obrigatorias = ['SESSION_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const faltando = obrigatorias.filter((k) => !env[k]);
  if (faltando.length) {
    throw new Error(`Configuração incompleta: faltou ${faltando.join(', ')} no .env`);
  }
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '127.0.0.1',
    db: {
      host: env.DB_HOST,
      port: Number(env.DB_PORT) || 3306,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
    sessionSecret: env.SESSION_SECRET,
    sessionHours: Number(env.SESSION_HOURS) || 8,
    minScale: 0.75,
    bcryptCost: Number(env.BCRYPT_COST) || 12,
    cookieSecure: env.COOKIE_SECURE !== 'false',
    // Prefixo de publicação (ex.: /boletim_ti); inválido derruba a subida com mensagem clara.
    basePath: normalizeBasePath(env.BASE_PATH),
  };
}

let cached;
module.exports = {
  loadConfig,
  get config() {
    if (!cached) cached = loadConfig();
    return cached;
  },
};
