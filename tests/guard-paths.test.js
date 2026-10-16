// Guarda contra caminhos internos absolutos esquecidos (quebrariam sob BASE_PATH, ex.: /boletim_ti).
//
// REGRA
//  1. src/views/**/*.ejs: nenhum atributo href/action/src/formaction/poster com valor literal que comece
//     por "/" (ex.: href="/login"). URLs internas devem sair de <%= u('/login') %>, que prefixa o BASE_PATH.
//  2. src/public/*.js: nenhuma chamada fetch( / location.assign( / location.replace( / window.open( /
//     location.href = / .href = / .src = cujo argumento seja um literal de string que comece por "/".
//     Use Api.url('/x') (navegação, fetch direto, img.src) ou Api.json('GET', '/x') (que já prefixa).
//     Chamadas Api.json(...) e Api.url(...) não são varridas: recebem caminhos da aplicação por contrato.
//
// EXCEÇÕES (não são varridas / não são erro)
//  - URLs externas (http://, https://) e protocol-relative ("//host"): não são caminhos internos.
//  - data: URIs (ex.: href="data:,"), âncoras "#principal", mailto:, e valores que começam por <%.
//  - Linhas de comentário em .js (começam por // ou * ou /*).
//  - Texto de conteúdo do comunicado e dados do usuário: não são atributos de URL.
//
// Falhas listam arquivo:linha. O scanner é testado contra amostras para provar que não é inócuo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'src');

// "/x" literal, mas não "//x" (protocol-relative, externo).
const ATRIBUTO_EJS = /\b(?:href|action|src|formaction|poster)\s*=\s*(["'])\/(?!\/)/i;
const CHAMADA_JS = /(?:\bfetch\s*\(|\blocation\.(?:assign|replace)\s*\(|\bwindow\.open\s*\()\s*(["'`])\/(?!\/)/;
const ATRIBUICAO_JS = /(?:\blocation\.href|\.href|\.src)\s*=\s*(["'`])\/(?!\/)/;

function varrerEjs(texto) {
  const achados = [];
  texto.split(/\r?\n/).forEach((linha, i) => {
    if (ATRIBUTO_EJS.test(linha)) achados.push({ linha: i + 1, trecho: linha.trim() });
  });
  return achados;
}

function varrerJs(texto) {
  const achados = [];
  texto.split(/\r?\n/).forEach((linha, i) => {
    const t = linha.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (CHAMADA_JS.test(linha) || ATRIBUICAO_JS.test(linha)) achados.push({ linha: i + 1, trecho: t });
  });
  return achados;
}

function listar(dir, ext) {
  const out = [];
  for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, nome.name);
    if (nome.isDirectory()) out.push(...listar(p, ext));
    else if (nome.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function relatorio(arquivos, varrer) {
  const falhas = [];
  for (const arq of arquivos) {
    for (const a of varrer(fs.readFileSync(arq, 'utf8'))) {
      falhas.push(`${path.relative(path.join(RAIZ, '..'), arq)}:${a.linha}  ${a.trecho}`);
    }
  }
  return falhas;
}

test('scanner EJS: pega caminhos literais e ignora o que é permitido', () => {
  assert.equal(varrerEjs('<a href="/login">x</a>').length, 1);
  assert.equal(varrerEjs("<form action='/logout'>").length, 1);
  assert.equal(varrerEjs('<img src="/api/configuracoes/logo">').length, 1);
  assert.equal(varrerEjs('<link rel="stylesheet" href="/app.css">').length, 1);
  assert.equal(varrerEjs('<script src="/<%= s %>"></script>').length, 1);
  assert.equal(varrerEjs('<a href="<%= u(\'/login\') %>">').length, 0);
  assert.equal(varrerEjs('<link rel="icon" href="data:,">').length, 0);
  assert.equal(varrerEjs('<a href="#principal">').length, 0);
  assert.equal(varrerEjs('<a href="https://exemplo.com/x">').length, 0);
  assert.equal(varrerEjs('<a href="//cdn.exemplo.com/x">').length, 0);
  assert.equal(varrerEjs('<a href="mailto:ti@senar.org.br">').length, 0);
});

test('scanner JS: pega fetch/location/src com literal "/" e ignora Api.url/Api.json/comentários', () => {
  assert.equal(varrerJs("fetch('/edicoes/' + ID)").length, 1);
  assert.equal(varrerJs('const r = await fetch(`/x/${id}`);').length, 1);
  assert.equal(varrerJs("window.location.assign('/login');").length, 1);
  assert.equal(varrerJs("location.href = '/login';").length, 1);
  assert.equal(varrerJs("img.src = '/api/x?t=' + 1;").length, 1);
  assert.equal(varrerJs("fetch(Api.url('/edicoes/' + ID))").length, 0);
  assert.equal(varrerJs("window.location.assign(Api.url('/login'));").length, 0);
  assert.equal(varrerJs("await Api.json('PUT', '/edicoes/' + ID, corpo);").length, 0);
  assert.equal(varrerJs("img.src = Api.url('/api/x');").length, 0);
  assert.equal(varrerJs("fetch('https://exemplo.com/x')").length, 0);
  assert.equal(varrerJs("// fetch('/exemplo') em comentário").length, 0);
  assert.equal(varrerJs('a.href = url;').length, 0);
});

test('views: nenhum href/action/src com caminho interno literal', () => {
  const arquivos = listar(path.join(RAIZ, 'views'), '.ejs');
  assert.ok(arquivos.length >= 10, 'views não encontradas');
  const falhas = relatorio(arquivos, varrerEjs);
  assert.deepEqual(falhas, [], "Use <%= u('/caminho') %>:\n" + falhas.join('\n'));
});

test('public: nenhum fetch/navegação/src com caminho interno literal fora de Api.url/Api.json', () => {
  const arquivos = listar(path.join(RAIZ, 'public'), '.js');
  assert.ok(arquivos.length >= 5, 'scripts não encontrados');
  const falhas = relatorio(arquivos, varrerJs);
  assert.deepEqual(falhas, [], "Use Api.url('/caminho') ou Api.json(...):\n" + falhas.join('\n'));
});
