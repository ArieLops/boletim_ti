// Verificação estática dos arquivos de implantação (Apache, Docker, guias). Sem banco, sem Docker, sem Apache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const existe = (rel) => fs.existsSync(path.join(raiz, rel));

const ARQUIVOS_NOVOS = [
  'Dockerfile',
  '.dockerignore',
  'deploy/apache/boletim_ti.conf',
  'deploy/apache/README.md',
  'deploy/docker/README.md',
  'deploy/ATUALIZACAO.md',
];

// ---------- funções de verificação (com casos negativos abaixo) ----------

const VALOR_PLACEHOLDER = /^(<|\$|"?\$\(|troque|TROQUE|SENHA|senha-|\.\.\.|xxx|XXX|\\|$)/;

// Devolve as linhas "SENHA=valor"/"SECRET=valor" cujo valor parece uma credencial real.
function credenciaisSuspeitas(texto) {
  const achados = [];
  for (const linha of texto.split(/\r?\n/)) {
    const m = /(password|secret)\s*=\s*(\S*)/i.exec(linha);
    if (m && !VALOR_PLACEHOLDER.test(m[2])) achados.push(linha.trim());
  }
  return achados;
}

function globParaRegex(padrao) {
  const re = padrao
    .split('')
    .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp('^' + re + '$');
}

// Aproximação do .dockerignore: padrões relativos à raiz do contexto, "!" reinclui, o último que casa vence.
// Um padrão que casa com um diretório exclui tudo dentro dele.
function excluidoPeloDockerignore(caminho, texto) {
  const partes = caminho.split('/');
  let excluido = false;
  for (const bruto of texto.split(/\r?\n/)) {
    let p = bruto.trim();
    if (!p || p.startsWith('#')) continue;
    const nega = p.startsWith('!');
    if (nega) p = p.slice(1);
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    const re = globParaRegex(p);
    const casa = partes.some((_, i) => re.test(partes.slice(0, i + 1).join('/')));
    if (casa) excluido = !nega;
  }
  return excluido;
}

const DIRETIVAS_PERMITIDAS = [
  /^RedirectMatch permanent \^\/boletim_ti\$ \/boletim_ti\/$/,
  /^ProxyPass \/boletim_ti\/ http:\/\/127\.0\.0\.1:3100\/boletim_ti\/( [a-z]+=\S+)*$/,
  /^ProxyPassReverse \/boletim_ti\/ http:\/\/127\.0\.0\.1:3100\/boletim_ti\/$/,
  /^<Location \/boletim_ti\/>$/,
  /^<\/Location>$/,
  /^ProxyPreserveHost On$/,
  /^Require ip \S+$/,
  /^<IfModule mod_headers\.c>$/,
  /^<\/IfModule>$/,
  /^RequestHeader unset X-Forwarded-Proto$/,
  /^RequestHeader set X-Forwarded-Proto "https" env=HTTPS$/,
];

// Devolve a lista de problemas do snippet do Apache (vazia = ok).
function problemasDoSnippet(texto) {
  const problemas = [];
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());
  let dentroIfModule = false;
  for (const l of linhas) {
    if (!l || l.startsWith('#')) continue;
    if (!DIRETIVAS_PERMITIDAS.some((re) => re.test(l))) problemas.push('diretiva fora da lista permitida: ' + l);
    if (l === '<IfModule mod_headers.c>') dentroIfModule = true;
    if (l === '</IfModule>') dentroIfModule = false;
    if (/^RequestHeader\b/.test(l) && !dentroIfModule) problemas.push('RequestHeader fora de IfModule mod_headers.c: ' + l);
  }
  for (const exigido of [
    'ProxyPass /boletim_ti/ http://127.0.0.1:3100/boletim_ti/',
    'ProxyPassReverse /boletim_ti/ http://127.0.0.1:3100/boletim_ti/',
    'FAIXA_AUTORIZADA_AQUI',
  ]) {
    if (!texto.includes(exigido)) problemas.push('ausente: ' + exigido);
  }
  return problemas;
}

// ---------- testes ----------

test('arquivos de implantação existem', () => {
  for (const rel of ARQUIVOS_NOVOS) assert.ok(existe(rel), rel + ' deveria existir');
});

test('Dockerfile: base, usuário, healthcheck, chromium e instalação sem devDependencies', () => {
  const d = ler('Dockerfile');
  for (const trecho of ['FROM node:22', 'USER node', 'HEALTHCHECK', '/usr/bin/chromium', 'npm ci --omit=dev', 'CMD ["node","src/server.js"]']) {
    assert.ok(d.includes(trecho), 'Dockerfile sem: ' + trecho);
  }
  assert.ok(!/^\s*ENV\b.*(PASSWORD|SECRET)/im.test(d), 'ENV com senha/segredo no Dockerfile');
  assert.deepEqual(credenciaisSuspeitas(d), []);
});

test('.dockerignore exclui o que não vai para a imagem e mantém o necessário', () => {
  const t = ler('.dockerignore');
  for (const p of ['node_modules', '.env', '.env.test', '.git', '.tools', '.superpowers', 'tests', 'docs', 'deploy']) {
    assert.ok(excluidoPeloDockerignore(p, t), p + ' deveria ser excluído');
  }
  for (const p of ['src', 'src/server.js', 'package.json', 'package-lock.json', 'scripts/create-admin.js', 'scripts/smoke-export.js']) {
    assert.ok(!excluidoPeloDockerignore(p, t), p + ' NÃO pode ser excluído (a imagem precisa dele)');
  }
});

test('verificador do .dockerignore pega erros (casos negativos)', () => {
  assert.equal(excluidoPeloDockerignore('src/app.js', 'src\n'), true);
  assert.equal(excluidoPeloDockerignore('src/app.js', 'src\n!src\n'), false);
  assert.equal(excluidoPeloDockerignore('.env.test', '.env*\n'), true);
  assert.equal(excluidoPeloDockerignore('package.json', '*.json\n'), true);
  assert.equal(excluidoPeloDockerignore('scripts/smoke-export.js', 'scripts\n'), true);
  assert.equal(excluidoPeloDockerignore('tests', '# tests\n'), false);
});

test('snippet do Apache: proxy com prefixo mantido, faixa pendente, sem escopo além de /boletim_ti', () => {
  const c = ler('deploy/apache/boletim_ti.conf');
  assert.deepEqual(problemasDoSnippet(c), []);
  assert.ok(!/^\s*(ProxyPass|ProxyPassMatch|ProxyPassReverse)\s+\/\s/m.test(c), 'ProxyPass curinga na raiz');
  assert.ok(!/^\s*RewriteRule\b/m.test(c), 'RewriteRule no snippet interferiria na regra global');
  assert.ok(!/^\s*ProxyTimeout\b/m.test(c), 'ProxyTimeout é global ao vhost; use timeout= no ProxyPass');
  assert.match(c, /timeout=90/);
});

test('verificador do snippet pega escopo indevido (casos negativos)', () => {
  const ok = ler('deploy/apache/boletim_ti.conf');
  assert.notDeepEqual(problemasDoSnippet(ok + '\nProxyPass / http://127.0.0.1:3100/\n'), []);
  assert.notDeepEqual(problemasDoSnippet(ok + '\nRewriteRule ^ https://x [R=301]\n'), []);
  assert.notDeepEqual(problemasDoSnippet(ok + '\nProxyTimeout 90\n'), []);
  assert.notDeepEqual(problemasDoSnippet(ok + '\nRequestHeader set X-Forwarded-Proto "https"\n'), []);
  assert.notDeepEqual(problemasDoSnippet(ok.replace('FAIXA_AUTORIZADA_AQUI', '10.0.0.0/8')), []);
  assert.notDeepEqual(problemasDoSnippet(ok.replace(/^ProxyPassReverse.*$/m, '')), []);
});

test('README do Apache: regra de exceção, configtest, reversão e avisos', () => {
  const r = ler('deploy/apache/README.md');
  for (const trecho of [
    'RewriteCond %{REQUEST_URI} !^/boletim_ti(/|$)',
    'apachectl configtest',
    'systemctl reload apache2',
    'apachectl -S',
    'a2enmod headers',
    'Reverter',
    'grep -RIn "ProxyPass" /etc/apache2/',
    'FAIXA_AUTORIZADA_AQUI',
  ]) {
    assert.ok(r.includes(trecho), 'README do Apache sem: ' + trecho);
  }
});

test('README do Docker e guia de atualização', () => {
  const dk = ler('deploy/docker/README.md');
  for (const trecho of ['docker build -t boletim-senar:1.1 .', '127.0.0.1:3100:3000', '--env-file', 'smoke-export.js', 'não validado']) {
    assert.ok(dk.includes(trecho), 'README do Docker sem: ' + trecho);
  }
  const at = ler('deploy/ATUALIZACAO.md');
  assert.match(at, /^#+ .*Atualização/m);
  assert.match(at, /^#+ .*Rollback/m);
  assert.ok(at.includes('boletim-senar:1.0'));
});

test('nenhum arquivo novo contém credenciais', () => {
  for (const rel of ARQUIVOS_NOVOS) assert.deepEqual(credenciaisSuspeitas(ler(rel)), [], rel);
});

test('varredura de credenciais pega valores reais (casos negativos)', () => {
  assert.equal(credenciaisSuspeitas('DB_PASSWORD=abc123').length, 1);
  assert.equal(credenciaisSuspeitas('SESSION_SECRET=0123456789abcdef').length, 1);
  assert.equal(credenciaisSuspeitas('ENV SECRET=x').length, 1);
  assert.equal(credenciaisSuspeitas('DB_PASSWORD=<senha-do-banco>').length, 0);
  assert.equal(credenciaisSuspeitas('SESSION_SECRET=').length, 0);
  assert.equal(credenciaisSuspeitas('DB_PASSWORD=TROQUE-PELA-SENHA').length, 0);
});

test('.gitattributes força LF nos arquivos de implantação', () => {
  const g = ler('.gitattributes');
  for (const p of ['Dockerfile', '.dockerignore', 'deploy/**']) {
    assert.ok(new RegExp('^' + p.replace(/[.*]/g, '\\$&') + '\\s+text eol=lf', 'm').test(g), '.gitattributes sem LF para ' + p);
  }
});
