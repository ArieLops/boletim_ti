// Guarda contra caminhos internos absolutos esquecidos (quebrariam sob BASE_PATH, ex.: /boletim_ti).
//
// REGRA JS (src/public/*.js): fora de comentários, QUALQUER literal de string ou de template que comece
//   por "/" (e não por "//") é erro, a não ser que seja o argumento de caminho de
//     Api.url(<literal>   ou   Api.json(<método>, <literal>
//   (o contexto é lido nos tokens anteriores, tolerando espaços e quebras de linha). Isso pega:
//   fetch('/x'), location.assign('/x'), window.location = '/x', form.action = '/x', new URL('/x', ...),
//   indireção (const alvo = '/x/' + ID; fetch(alvo)), e literal em outra linha (fetch(\n '/x')).
//
// REGRA EJS (src/views/**/*.ejs):
//   - atributos href/src/action/formaction/poster/data-* com valor literal que comece por "/" (não "//"),
//     inclusive com quebra de linha entre "=" e o valor;
//   - url(/x) ou url('/x') em CSS inline;
//   - manipuladores on*="..." com literal "/x" dentro;
//   - dentro de <% ... %>: literal "/x" que não seja o argumento de u(...);
//   - dentro de <script> inline (sem src): mesma regra do JS.
//   URLs internas devem sair de <%= u('/caminho') %>.
//
// ISENÇÕES (estreitas)
//   - api.js: o corpo da função urlComBase (implementação do prefixo, compara com '/') e chamadas ao
//     url(...) local da própria api.js.
//   - Regex literais (ex.: /^#[0-9a-f]{6}$/) não são strings: o lexer os ignora.
//   - Comentários (// e /* */).
//   - URLs externas e protocol-relative ("//host"), data:, "#âncora", mailto: e valores que começam por <%.
//   - Conteúdo do comunicado e dados do usuário não são atributos de URL.
//
// BLINDAGENS CONHECIDAS (limites honestos do scanner, que é léxico e não executa o código)
//   - Caminho montado sem literal inicial com "/": ('a' + '/x'), join de partes, valor vindo de dados.
//   - Template literal aninhado dentro de ${...}: o conteúdo interno não é varrido.
//   - Caminho "/..." que chega ao cliente via atributo data-* gerado por <%= valor %> de dados (não literal).
//   - Arquivos fora de src/views e src/public (ex.: texto dentro de renderEdition) não são varridos.
// Falhas listam arquivo:linha. Os scanners são funções puras testadas com trechos ruins e bons abaixo, para
// provar que a guarda tem dentes sem editar o código-fonte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'src');

function ehInterno(conteudo) {
  return conteudo.charAt(0) === '/' && conteudo.charAt(1) !== '/';
}

// Lexer mínimo: devolve literais de string/template com posição e o código com comentários apagados
// (para a leitura do contexto anterior). Regex literais são ignorados.
function lexar(codigo) {
  const literais = [];
  let limpo = '';
  let i = 0;
  let ultimo = ''; // último caractere significativo de código (para distinguir regex de divisão)
  const n = codigo.length;
  const kwAntesRegex = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/;
  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && codigo[i] !== '\n') { limpo += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(codigo[i] === '*' && codigo[i + 1] === '/')) { limpo += codigo[i] === '\n' ? '\n' : ' '; i++; }
      limpo += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const ini = i;
      let prof = 0;
      i++;
      let conteudo = '';
      while (i < n) {
        const e = codigo[i];
        if (e === '\\') { conteudo += e + (codigo[i + 1] || ''); i += 2; continue; }
        if (c === '`' && e === '$' && codigo[i + 1] === '{') { prof++; conteudo += '${'; i += 2; continue; }
        if (c === '`' && prof > 0 && e === '}') { prof--; conteudo += e; i++; continue; }
        if (e === c && prof === 0) break;
        if (e === '\n' && c !== '`') break; // string não fechada: não engole o arquivo
        conteudo += e; i++;
      }
      i++;
      literais.push({ ini, fim: i, conteudo, aspas: c, antes: limpo });
      limpo += codigo.slice(ini, i).replace(/[^\n]/g, 'S');
      ultimo = 'S';
      continue;
    }
    if (c === '/') {
      const regexAqui = ultimo === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(ultimo) || kwAntesRegex.test(limpo.slice(-12));
      if (regexAqui) {
        let classe = false;
        const ini = i;
        i++;
        while (i < n && codigo[i] !== '\n') {
          if (codigo[i] === '\\') { i += 2; continue; }
          if (codigo[i] === '[') classe = true;
          else if (codigo[i] === ']') classe = false;
          else if (codigo[i] === '/' && !classe) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(codigo[i])) i++;
        limpo += codigo.slice(ini, i).replace(/[^\n]/g, 'R');
        ultimo = 'R';
        continue;
      }
    }
    limpo += c;
    if (!/\s/.test(c)) ultimo = c;
    i++;
  }
  return { literais, limpo };
}

const linhaDe = (texto, pos) => texto.slice(0, pos).split('\n').length;
const trechoDe = (texto, pos) => (texto.split('\n')[linhaDe(texto, pos) - 1] || '').trim();

// O literal é permitido se está no argumento de caminho de uma chamada permitida: dentro dos parênteses de
// Api.url( ... ) (qualquer expressão, inclusive concatenação) ou, para Api.json(método, ...), no segundo
// argumento. Parênteses são buscados para trás sobre o código sem comentários (strings viram "S"); um "[" ou
// "{" aberto no meio (literal dentro de objeto/array) não conta.
const CHAMADAS_JS = [{ re: /\bApi\.url\s*$/, virgulas: 0 }, { re: /\bApi\.json\s*$/, virgulas: 1 }];
const CHAMADAS_EJS = [{ re: /(?<![\w$.])u\s*$/, virgulas: 0 }];
const CHAMADAS_API_JS = [{ re: /(?<![\w$.])url\s*$/, virgulas: 0 }];

function emChamadaPermitida(antes, chamadas) {
  let prof = 0;
  let virgulas = 0;
  for (let k = antes.length - 1; k >= 0; k--) {
    const c = antes[k];
    if (c === ')' || c === ']' || c === '}') prof++;
    else if (c === '(' || c === '[' || c === '{') {
      if (prof > 0) { prof--; continue; }
      if (c !== '(') return false;
      const cabeca = antes.slice(0, k);
      return chamadas.some((ch) => ch.re.test(cabeca) && ch.virgulas === virgulas);
    } else if (c === ',' && prof === 0) virgulas++;
  }
  return false;
}

function escanearJs(codigo, nomeArquivo, opcoes = {}) {
  const { literais } = lexar(codigo);
  const chamadas = opcoes.chamadas || CHAMADAS_JS;
  const base = path.basename(nomeArquivo || '');
  let isento = null; // [ini, fim) do corpo de urlComBase em api.js
  if (base === 'api.js') {
    const m = /function\s+urlComBase\s*\(/.exec(codigo);
    if (m) {
      let k = codigo.indexOf('{', m.index);
      let prof = 0;
      const ini = k;
      for (; k < codigo.length; k++) {
        if (codigo[k] === '{') prof++;
        else if (codigo[k] === '}' && --prof === 0) break;
      }
      isento = [ini, k];
    }
  }
  const achados = [];
  for (const l of literais) {
    if (!ehInterno(l.conteudo)) continue;
    if (isento && l.ini >= isento[0] && l.ini < isento[1]) continue;
    if (emChamadaPermitida(l.antes, chamadas)) continue;
    if (base === 'api.js' && emChamadaPermitida(l.antes, CHAMADAS_API_JS)) continue;
    achados.push({ arquivo: nomeArquivo, linha: linhaDe(codigo, l.ini), trecho: trechoDe(codigo, l.ini) });
  }
  return achados;
}

const ATRIBUTO = /\b(?:href|action|src|formaction|poster|data-[\w-]+)\s*=\s*(["'])\/(?!\/)/gi;
const CSS_URL = /(?<![\w$.])url\(\s*['"]?\/(?!\/)/gi;
const MANIPULADOR = /\bon\w+\s*=\s*"[^"]*['"]\/(?!\/)|\bon\w+\s*=\s*'[^']*["']\/(?!\/)/gi;

function escanearEjs(texto, nomeArquivo) {
  const achados = [];
  const marca = (pos) => achados.push({ arquivo: nomeArquivo, linha: linhaDe(texto, pos), trecho: trechoDe(texto, pos) });
  for (const re of [ATRIBUTO, CSS_URL, MANIPULADOR]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto))) marca(m.index);
  }
  // Código dentro de <% ... %>: literais "/x" só como argumento de u(...)
  const tag = /<%[-=_#]?([\s\S]*?)[-_]?%>/g;
  let m;
  while ((m = tag.exec(texto))) {
    const ini = m.index + m[0].indexOf(m[1]);
    for (const a of escanearJs(m[1], nomeArquivo, { chamadas: CHAMADAS_EJS })) {
      achados.push({ arquivo: nomeArquivo, linha: linhaDe(texto, ini) + a.linha - 1, trecho: a.trecho });
    }
  }
  // <script> inline (sem src): código do navegador, com as tags EJS neutralizadas
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = script.exec(texto))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const corpo = m[2].replace(/<%[\s\S]*?%>/g, (t) => t.replace(/[^\n]/g, ' '));
    const ini = m.index + m[0].indexOf(m[2]);
    for (const a of escanearJs(corpo, nomeArquivo)) {
      achados.push({ arquivo: nomeArquivo, linha: linhaDe(texto, ini) + a.linha - 1, trecho: a.trecho });
    }
  }
  return achados;
}

function listar(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listar(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function relatorio(arquivos, escanear) {
  const falhas = [];
  for (const arq of arquivos) {
    const rel = path.relative(path.join(RAIZ, '..'), arq);
    for (const a of escanear(fs.readFileSync(arq, 'utf8'), arq)) falhas.push(`${rel}:${a.linha}  ${a.trecho}`);
  }
  return falhas;
}

// ---------- o scanner JS tem dentes ----------
test('escanearJs: pega os cinco padrões realistas e variações', () => {
  const ruins = {
    'window.location = literal': "window.location = '/login';",
    'form.action = literal': "form.action = '/x';",
    'new URL': "const u = new URL('/x', location.origin);",
    'indireção': "const alvo = '/edicoes/' + ID;\nfetch(alvo, { method: 'GET' });",
    'fetch em várias linhas': "await fetch(\n  '/x',\n  { credentials: 'same-origin' }\n);",
    'fetch direto': "fetch('/edicoes/' + ID)",
    'template literal': 'const r = await fetch(`/x/${id}`);',
    'location.assign': "window.location.assign('/login');",
    'location.href': "location.href = '/login';",
    'img.src': "img.src = '/api/x?t=' + 1;",
    'Api.url com literal que não é o primeiro argumento': "foo(Api.url('/a'), '/b');",
    'Api.json com URL no lugar errado': "Api.json('/edicoes', 'POST');",
    'só a barra': "const sep = '/';",
    'aspas duplas': 'location.replace("/login");',
  };
  for (const [nome, codigo] of Object.entries(ruins)) assert.ok(escanearJs(codigo, 'x.js').length >= 1, `deveria falhar: ${nome}`);
  const ind = escanearJs("const alvo = '/edicoes/' + ID;\nfetch(alvo);", 'x.js');
  assert.equal(ind[0].linha, 1);
  assert.equal(escanearJs("await fetch(\n  '/x'\n);", 'x.js')[0].linha, 2);
});

test('escanearJs: aceita o que é correto', () => {
  const bons = [
    "fetch(Api.url('/edicoes/' + ID))",
    "window.location.assign(Api.url('/login'));",
    "await Api.json('PUT', '/edicoes/' + ID, corpo);",
    "await Api.json(\n  'POST',\n  '/edicoes',\n  corpo\n);",
    "await Api.json(metodo, '/x');",
    "img.src = Api.url(\n  '/api/x?t=' + Date.now()\n);",
    'fetch(Api.url(`/edicoes/${id}`))',
    "fetch('https://exemplo.com/x')",
    "// fetch('/exemplo') em comentário",
    "/* location.assign('/x') */ a.href = url;",
    "const ok = /^\\/edicoes\\/\\d+$/.test(p);",
    "const dividido = a / b; const c = '//cdn.exemplo.com/x';",
    "const texto = 'a/b';",
  ];
  for (const codigo of bons) assert.deepEqual(escanearJs(codigo, 'x.js'), [], codigo);
});

test('escanearJs: exceções de api.js são estreitas', () => {
  const corpo = "function urlComBase(base, path) {\n  if (path.charAt(0) !== '/') throw 1;\n  return path;\n}\nconst url = (p) => urlComBase('', p);\n";
  assert.deepEqual(escanearJs(corpo + "  window.location.assign(url('/login'));", 'api.js'), []);
  assert.equal(escanearJs(corpo + "fetch('/x');", 'api.js').length, 1);
  assert.equal(escanearJs("const a = '/x';", 'api.js').length, 1);
  assert.equal(escanearJs("function urlComBase() {}\nlocation.assign(url('/x'));", 'outro.js').length, 1);
});

// ---------- o scanner EJS tem dentes ----------
test('escanearEjs: pega padrões ruins', () => {
  const ruins = {
    href: '<a href="/login">x</a>',
    'action aspas simples': "<form action='/logout'>",
    src: '<img src="/api/configuracoes/logo">',
    css: '<link rel="stylesheet" href="/app.css">',
    'src dinâmico': '<script src="/<%= s %>"></script>',
    'data-*': '<div data-url="/edicoes/1">',
    'url() css': '<div style="background: url(/img/x.png)">',
    'url() css com aspas': '<div style="background: url(\'/img/x.png\')">',
    'on* com literal': '<button onclick="location.href=\'/login\'">',
    'valor em outra linha': '<a href=\n  "/login">',
    'literal em tag EJS': '<a href="<%= \'/login\' %>">',
    'script inline': '<script>\n  fetch(\'/x\');\n</script>',
    'script inline com location': '<script>window.location = "/login";</script>',
  };
  for (const [nome, ejs] of Object.entries(ruins)) assert.ok(escanearEjs(ejs, 'x.ejs').length >= 1, `deveria falhar: ${nome}`);
  assert.equal(escanearEjs('<p>\n<a href="/login">x</a>', 'x.ejs')[0].linha, 2);
  assert.equal(escanearEjs('<p>\n<script>\n fetch("/x");\n</script>', 'x.ejs')[0].linha, 3);
});

test('escanearEjs: aceita o que é correto', () => {
  const bons = [
    "<a href=\"<%= u('/login') %>\">",
    "<a href=\"<%= u('/edicoes/' + e.id + '/historico') %>\">",
    "<script src=\"<%= u('/' + s) %>\"></script>",
    '<link rel="icon" href="data:,">',
    '<a href="#principal">',
    '<a href="https://exemplo.com/x">',
    '<a href="//cdn.exemplo.com/x">',
    '<a href="mailto:ti@senar.org.br">',
    '<% if (/^#[0-9a-fA-F]{6}$/.test(c.valor)) { %>',
    '<div data-id="<%= x.id %>" data-tipo="card">',
    '<script>const a = Api.url("/x");</script>',
    '<script src="x.js"></script>',
  ];
  for (const ejs of bons) assert.deepEqual(escanearEjs(ejs, 'x.ejs'), [], ejs);
});

// ---------- a árvore real está limpa ----------
test('views: nenhum caminho interno literal fora de u()', () => {
  const arquivos = listar(path.join(RAIZ, 'views'), '.ejs');
  assert.ok(arquivos.length >= 10, 'views não encontradas');
  const falhas = relatorio(arquivos, escanearEjs);
  assert.deepEqual(falhas, [], "Use <%= u('/caminho') %>:\n" + falhas.join('\n'));
});

test('public: nenhum literal "/..." fora de Api.url/Api.json', () => {
  const arquivos = listar(path.join(RAIZ, 'public'), '.js');
  assert.ok(arquivos.length >= 5, 'scripts não encontrados');
  const falhas = relatorio(arquivos, escanearJs);
  assert.deepEqual(falhas, [], "Use Api.url('/caminho') ou Api.json(método, '/caminho'):\n" + falhas.join('\n'));
});
