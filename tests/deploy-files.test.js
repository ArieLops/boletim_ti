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
  let dentroLocation = false;
  for (const l of linhas) {
    if (!l || l.startsWith('#')) continue;
    if (!DIRETIVAS_PERMITIDAS.some((re) => re.test(l))) problemas.push('diretiva fora da lista permitida: ' + l);
    if (l === '<IfModule mod_headers.c>') dentroIfModule = true;
    if (l === '</IfModule>') dentroIfModule = false;
    if (l === '<Location /boletim_ti/>') dentroLocation = true;
    if (l === '</Location>') dentroLocation = false;
    if (/^Require ip\b/.test(l) && !dentroLocation) problemas.push('Require ip fora de <Location /boletim_ti/>: ' + l);
    if (/^ProxyPreserveHost\b/.test(l) && !dentroLocation) problemas.push('ProxyPreserveHost fora de <Location /boletim_ti/>: ' + l);
    if (/^RequestHeader\b/.test(l) && !dentroIfModule) problemas.push('RequestHeader fora de IfModule mod_headers.c: ' + l);
  }
  for (const exigido of [
    'ProxyPass /boletim_ti/ http://127.0.0.1:3100/boletim_ti/',
    'ProxyPassReverse /boletim_ti/ http://127.0.0.1:3100/boletim_ti/',
    'FAIXA_AUTORIZADA_AQUI',
    '<Location /boletim_ti/>',
    '</Location>',
  ]) {
    if (!texto.includes(exigido)) problemas.push('ausente: ' + exigido);
  }
  return problemas;
}

// Problemas do Dockerfile (lista vazia = ok).
function problemasDoDockerfile(bruto) {
  const texto = bruto.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'); // ignora comentários
  const problemas = [];
  for (const trecho of ['FROM node:22', 'USER node', 'HEALTHCHECK', '/usr/bin/chromium', 'npm ci --omit=dev', 'CMD ["node","src/server.js"]', 'HOST=0.0.0.0', 'EXPOSE 3000']) {
    if (!texto.includes(trecho)) problemas.push('sem: ' + trecho);
  }
  if (/^\s*ENV\b.*(PASSWORD|SECRET)/im.test(texto)) problemas.push('ENV com senha/segredo');
  return problemas;
}

// Comandos "docker run" (com continuação de linha "\") de um texto, opcionalmente só os que usam certa imagem.
function comandosDockerRun(texto, imagem) {
  const juntado = texto.replace(/\\\n\s*/g, ' ');
  return juntado.split('\n').map((l) => l.trim()).filter((l) => /^docker run\b/.test(l) && (!imagem || l.includes(imagem)));
}

// Cada docker run (da imagem dada) precisa de --init e --shm-size (Chromium); devolve os que não têm.
function runsSemInitOuShm(texto, imagem) {
  return comandosDockerRun(texto, imagem).filter((c) => !/--init\b/.test(c) || !/--shm-size=\d+[mg]\b/.test(c));
}

// O backup do 000-default.conf precisa copiar o arquivo RESOLVIDO (em sites-enabled ele é link simbólico).
function backupResolvido(texto) {
  return texto.includes('cp -p "$(readlink -f /etc/apache2/sites-enabled/000-default.conf)"') && !/cp -a \/etc\/apache2\/sites-enabled\/000-default\.conf/.test(texto);
}

// Linhas lógicas (continuação "\" unida, comentários e vazias fora) dos blocos ```bash de um guia.
function comandosBash(texto) {
  const comandos = [];
  for (const m of texto.matchAll(/```bash\n([\s\S]*?)```/g)) {
    const juntado = m[1].replace(/\\\n\s*/g, ' ');
    for (const l of juntado.split('\n').map((x) => x.trim())) {
      if (l && !l.startsWith('#')) comandos.push(l);
    }
  }
  return comandos;
}

// Divide um comando em segmentos nos operadores (&&, ||, ;, |) fora de aspas.
function segmentos(cmd) {
  const out = [];
  let atual = '';
  let aspa = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (aspa) {
      if (c === aspa) aspa = null;
      atual += c;
    } else if (c === "'" || c === '"') {
      aspa = c;
      atual += c;
    } else if (c === '#' && (i === 0 || /\s/.test(cmd[i - 1]))) {
      break; // comentário até o fim da linha
    } else if (c === ';' || c === '|' || (c === '&' && cmd[i + 1] === '&')) {
      out.push(atual);
      atual = '';
      if (cmd[i + 1] === c) i++;
    } else {
      atual += c;
    }
  }
  out.push(atual);
  return out.map((x) => x.trim()).filter(Boolean);
}

// /root é 0700: todo segmento que cita /root/ precisa começar com sudo, e glob em /root/ só funciona dentro de "sudo sh -c".
function comandosRootSemSudo(comandos) {
  return comandos.filter((c) =>
    segmentos(c).some((seg) => {
      if (!seg.includes('/root/')) return false;
      if (!/^sudo\b/.test(seg)) return true;
      return /\/root\/\S*\*/.test(seg) && !/^sudo sh -c /.test(seg);
    }));
}

// ---------- testes ----------

test('arquivos de implantação existem', () => {
  for (const rel of ARQUIVOS_NOVOS) assert.ok(existe(rel), rel + ' deveria existir');
});

test('Dockerfile: base, usuário, healthcheck, chromium e instalação sem devDependencies', () => {
  const d = ler('Dockerfile');
  assert.deepEqual(problemasDoDockerfile(d), []);
  assert.deepEqual(credenciaisSuspeitas(d), []);
});

test('verificador do Dockerfile pega erros (casos negativos)', () => {
  const d = ler('Dockerfile');
  assert.notDeepEqual(problemasDoDockerfile(d.replaceAll('HOST=0.0.0.0', 'HOST=127.0.0.1')), []);
  assert.notDeepEqual(problemasDoDockerfile(d.replace('EXPOSE 3000', '')), []);
  assert.notDeepEqual(problemasDoDockerfile(d.replace('USER node', '')), []);
  assert.notDeepEqual(problemasDoDockerfile(d + '\nENV DB_PASSWORD=abc\n'), []);
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
  // sem as linhas do Location, o "Require ip" ficaria no escopo do vhost inteiro
  const semLocation = ok.replace(/^\s*<\/?Location[^>]*>\s*$/gm, '');
  assert.ok(problemasDoSnippet(semLocation).some((p) => p.includes('Require ip fora')));
  assert.ok(problemasDoSnippet(semLocation).some((p) => p.startsWith('ausente: <Location')));
  // Require ip antes do Location também é erro
  assert.notDeepEqual(problemasDoSnippet('Require ip 10.0.0.0/8\n' + ok), []);
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

test('README do Apache: backup do arquivo resolvido (link simbólico) e HTTPS remove a exceção', () => {
  const r = ler('deploy/apache/README.md');
  assert.ok(backupResolvido(r), 'backup deve usar readlink -f');
  assert.match(r, /DESTINO="\$\(readlink -f /, 'restauração deve usar o arquivo resolvido');
  assert.match(r, /Remover.*RewriteCond %\{REQUEST_URI\} !\^\/boletim_ti/s);
  assert.match(ler('deploy/ATUALIZACAO.md'), /DESTINO="\$\(readlink -f /);
});

test('verificador do backup pega cópia do link (caso negativo)', () => {
  assert.equal(backupResolvido('sudo cp -a /etc/apache2/sites-enabled/000-default.conf /root/x'), false);
  assert.equal(backupResolvido('sudo cp -p "$(readlink -f /etc/apache2/sites-enabled/000-default.conf)" /root/x'), true);
  assert.equal(backupResolvido('sudo cp -p "$(readlink -f /etc/apache2/sites-enabled/000-default.conf)" /root/x\nsudo cp -a /etc/apache2/sites-enabled/000-default.conf /root/y'), false);
});

test('docker run dos guias usa --init e --shm-size', () => {
  const dk = ler('deploy/docker/README.md');
  assert.ok(comandosDockerRun(dk).length >= 2, 'esperava >= 2 exemplos de docker run');
  assert.deepEqual(runsSemInitOuShm(dk), []);
  const at = ler('deploy/ATUALIZACAO.md');
  assert.ok(comandosDockerRun(at, 'boletim-senar:1.1').length >= 2);
  assert.deepEqual(runsSemInitOuShm(at, 'boletim-senar:1.1'), []);
});

test('verificador de docker run pega falta de --init/--shm-size (casos negativos)', () => {
  assert.equal(runsSemInitOuShm('docker run -d --name x img:1.1', 'img:1.1').length, 1);
  assert.equal(runsSemInitOuShm('docker run -d --init --name x img:1.1', 'img:1.1').length, 1);
  assert.equal(runsSemInitOuShm('docker run -d --shm-size=64 --init img:1.1', 'img:1.1').length, 1);
  assert.equal(runsSemInitOuShm('docker run -d \\\n  --init \\\n  --shm-size=512m \\\n  img:1.1', 'img:1.1').length, 0);
  assert.equal(runsSemInitOuShm('docker run -d img:1.0', 'img:1.1').length, 0);
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

test('guias: todo comando que usa /root/ está sob sudo (e glob dentro de sudo sh -c)', () => {
  for (const rel of ['deploy/apache/README.md', 'deploy/docker/README.md', 'deploy/ATUALIZACAO.md']) {
    const cmds = comandosBash(ler(rel));
    assert.ok(cmds.length > 3, rel + ': nenhum bloco bash encontrado');
    assert.deepEqual(comandosRootSemSudo(cmds), [], rel);
  }
  assert.ok(comandosBash(ler('deploy/ATUALIZACAO.md')).some((c) => c.includes('/root/')), 'esperava comandos com /root/');
});

test('verificador de /root sem sudo pega erros (casos negativos)', () => {
  const ruim = (t) => comandosRootSemSudo(comandosBash('```bash\n' + t + '\n```\n'));
  assert.equal(ruim('ls -l /root/apache-backups/').length, 1);
  assert.equal(ruim('file /root/apache-backups/x.*').length, 1);
  assert.equal(ruim('sudo file /root/apache-backups/x.*').length, 1); // glob expandido fora do root
  assert.equal(ruim('cat /root/a | sudo tee /etc/x').length, 1);
  assert.equal(ruim('sudo ls -l /root/apache-backups/').length, 0);
  assert.equal(ruim("sudo sh -c 'file /root/apache-backups/x.*'").length, 0);
  assert.equal(ruim('sudo cp -p /etc/a \\\n  /root/b').length, 0); // continuação
  assert.equal(ruim('cp /etc/a \\\n  /root/b').length, 1);
  assert.equal(ruim('# ls /root/x (comentário)').length, 0);
});

// O rollback só pode remover $NOVO depois de checar que a imagem é a 1.1 (NOVO pode ser o próprio 1.0).
function rollbackComGuard(texto) {
  const i = texto.indexOf('## Rollback');
  if (i < 0) return false;
  const sec = texto.slice(i);
  const rm = sec.indexOf('docker rm "$NOVO"');
  const guard = sec.indexOf('= "boletim-senar:1.1"');
  return rm >= 0 && guard >= 0 && guard < rm && sec.includes("docker inspect -f '{{.Config.Image}}'");
}

test('rollback checa a imagem 1.1 antes de remover $NOVO', () => {
  assert.ok(rollbackComGuard(ler('deploy/ATUALIZACAO.md')));
});

test('verificador do guard de rollback (casos negativos)', () => {
  const guard = "IMG=\"$(docker inspect -f '{{.Config.Image}}' \"$NOVO\")\"\nif [ \"$IMG\" = \"boletim-senar:1.1\" ]; then\n";
  const rm = 'docker rm "$NOVO"\n';
  assert.equal(rollbackComGuard('## Rollback\n' + guard + rm), true);
  assert.equal(rollbackComGuard('## Rollback\ndocker stop "$NOVO" && ' + rm), false);
  assert.equal(rollbackComGuard('## Rollback\n' + rm + guard), false);
  assert.equal(rollbackComGuard(guard + rm), false);
});
