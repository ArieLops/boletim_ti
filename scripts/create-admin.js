// Uso: node --env-file=.env scripts/create-admin.js "<nome>" <login>
// A senha é pedida no terminal (sem eco); nunca é aceita por argumento.

const MIN_SENHA = 8;

function lerSenha(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Execute em um terminal interativo (a senha não é lida de pipe/argumentos).'));
    process.stdout.write(prompt);
    let senha = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(senha);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          return reject(new Error('Cancelado.'));
        }
        if (ch === '\u007f' || ch === '\b') senha = senha.slice(0, -1);
        else senha += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const [nome, login] = process.argv.slice(2);
  if (!nome || !login || process.argv.length > 4) {
    console.error('Uso: node --env-file=.env scripts/create-admin.js "<nome>" <login>');
    process.exitCode = 1;
    return;
  }
  const senha = await lerSenha('Senha (mínimo 8 caracteres): ');
  if (senha.length < MIN_SENHA) throw new Error(`A senha deve ter pelo menos ${MIN_SENHA} caracteres.`);
  const confirmacao = await lerSenha('Confirme a senha: ');
  if (senha !== confirmacao) throw new Error('As senhas não conferem.');

  // require tardio: pool.js lê a configuração (.env) ao ser importado
  const { getPool } = require('../src/db/pool');
  const { migrate } = require('../src/db/migrate');
  const { makeUsersRepo } = require('../src/repos/users');
  const pool = getPool();
  await migrate(pool);
  const id = await makeUsersRepo(pool).createUser({ nome, login, senha, perfil: 'administrador' });
  console.log(`Administrador "${login}" criado (id ${id}). Será pedida a troca de senha no primeiro acesso.`);
}

main()
  .catch((e) => {
    console.error(e.code === 'ER_DUP_ENTRY' ? `Já existe um usuário com o login informado.` : `Erro: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (require.cache[require.resolve('../src/db/pool')]) await require('../src/db/pool').closePool();
  });
