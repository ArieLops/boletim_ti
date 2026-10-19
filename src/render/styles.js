const fs = require('node:fs');
const path = require('node:path');

const ASSETS = path.join(__dirname, 'assets');

// Paleta padrao amostrada do PDF modelo; cada chave vira variavel :root e pode ser sobrescrita por settings.cores.
const CORES_PADRAO = {
  '--verde-escuro': '#093d38',
  '--verde-medio': '#48b65a',
  '--verde-claro': '#85d177',
  '--verde-palido': '#bfe6c4',
  '--teal': '#087e6f',
  '--fundo': '#f5f8f5',
  '--card-fundo': '#ffffff',
  '--borda': '#d4e4db',
  '--etiqueta-fundo': '#e4f3ea',
  '--amarelo': '#f5b541',
  '--texto': '#17342e',
  '--texto-suave': '#526c66',
};

// Fonte Inter (OFL) embutida em base64 para funcionar offline no Chromium headless. Só cobre o subconjunto
// latino: emoji e símbolos (✅ ⚠️ 📌 → ✓) dependem das fontes do sistema (veja deploy/INSTALL.md, passo 2).
// Origem dos arquivos e licença: src/render/assets/README.md.
const PESOS = [400, 500, 600, 700, 800];
const FONT_FACES = PESOS.map((w) => {
  const b64 = fs.readFileSync(path.join(ASSETS, `inter-latin-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:Inter;font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}).join('');

const VAR_NOME = /^--[a-z0-9-]{1,40}$/;
const VAR_VALOR = /^[#a-zA-Z0-9(),.%\s-]{1,60}$/;

function rootVars(escala, cores) {
  const mapa = { ...CORES_PADRAO };
  if (cores && typeof cores === 'object') {
    for (const [k, v] of Object.entries(cores)) {
      if (VAR_NOME.test(k) && typeof v === 'string' && VAR_VALOR.test(v)) mapa[k] = v.trim();
    }
  }
  const linhas = Object.entries(mapa).map(([k, v]) => `${k}:${v};`).join('');
  return `:root{--escala:${escala};${linhas}}`;
}

// Todo tamanho em px de layout passa por s(n) = calc(n px * escala).
const s = (n) => `calc(${n}px * var(--escala))`;
const neg = (n) => `calc(${n}px * var(--escala) * -1)`;

// Pagina publica (modo web): barra de downloads e ajustes de tela estreita. Sem JavaScript.
const CSS_WEB = `.barra-publica{background:#fff;border-bottom:1px solid var(--borda);padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
.barra-publica a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:8px;background:var(--teal);color:#fff;font-size:14px;font-weight:600;line-height:1.2;text-align:center;text-decoration:none;}
.barra-publica a:hover{background:var(--verde-escuro);}
.barra-publica a:focus-visible{outline:3px solid var(--verde-escuro);outline-offset:2px;}
@media print{.barra-publica{display:none;}}
@media (max-width:640px){
.cabecalho{--escala:.6;}
.barra-publica{flex-direction:column;}
.corpo{padding:20px 16px 8px;}
.linha-edicao{padding:10px 16px 0;}
.titulo-secao{padding-left:14px;margin-bottom:24px;}
.grade-cards{grid-template-columns:1fr;gap:16px;}
.bloco-destaque{padding:16px;}
.bloco-destaque h2{margin:20px 0 0 0;}
.bloco-destaque .texto{margin:16px 0 12px 0;padding-right:0;text-align:left;}
.bloco-destaque .chamada{padding-left:0;}
.bloco-card h3{padding-right:0;}
.bloco-dica{padding:18px 18px 18px 22px;}
.bloco-dica::before{left:14px;}
.rodape{margin:0 16px;flex-wrap:wrap;}
}
`;

function buildCss({ mode, escala, cores }) {
  const web = mode === 'web';
  const a4 = mode === 'a4';
  const pagina = web
    ? 'max-width:960px;margin:0 auto;'
    : a4
      ? 'width:210mm;height:297mm;overflow:hidden;position:relative;'
      : 'width:1080px;';
  // #conteudo: em A4 ocupa a altura da pagina (flex coluna, overflow hidden); como os filhos nao encolhem,
  // seu scrollHeight reflete a altura natural do conteudo quando excede a pagina (medido pelo exportador).
  const conteudo = a4
    ? 'height:100%;display:flex;flex-direction:column;overflow:hidden;'
    : 'display:flex;flex-direction:column;';
  return `${FONT_FACES}${rootVars(escala, cores)}
*{box-sizing:border-box;margin:0;padding:0;}
${a4 ? '@page{size:A4;margin:0}\n' : ''}html,body{background:var(--fundo);}
body{font-family:Inter,"Segoe UI",system-ui,sans-serif,"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji";color:var(--texto);-webkit-font-smoothing:antialiased;}
.pagina{${pagina}background:var(--fundo);}
#conteudo{${conteudo}}
#conteudo>*{flex-shrink:0;}
.bloco,.bloco *,.etiqueta,.chamada,.texto,.bloco h2,.bloco h3,.cabeca-grupo h2,.titulo-secao h1,.titulo-secao p,.cabecalho *,.rodape *,.linha-edicao{overflow-wrap:anywhere;}
.cabecalho{position:relative;margin-top:${s(9)};height:${s(182)};background:var(--verde-escuro);}
.topo-barra{position:absolute;top:${neg(9)};left:0;right:0;height:${s(9)};background:var(--verde-medio);}
.barras{position:absolute;left:${s(48)};top:${s(36)};display:flex;align-items:flex-end;gap:${s(5.5)};height:${s(70)};}
.barras i{display:block;width:${s(7)};border-radius:${s(4)};background:var(--verde-claro);}
.barras i:nth-child(1){height:${s(52)};}.barras i:nth-child(2){height:${s(58)};}.barras i:nth-child(3){height:${s(62)};}
.barras i:nth-child(4){height:${s(66)};}.barras i:nth-child(5){height:${s(70)};}
.marca{position:absolute;left:${s(139)};top:${s(37)};}
.marca .senar{font-size:${s(44)};font-weight:800;line-height:1;color:#fff;letter-spacing:${s(0.5)};}
.marca .rgs{margin-top:${s(8)};font-size:${s(15)};font-weight:700;line-height:1;color:var(--verde-palido);letter-spacing:${s(0.3)};}
.cabecalho .nome{position:absolute;left:${s(56)};bottom:${s(22)};font-size:${s(24)};font-weight:700;line-height:1.1;color:#fff;max-width:60%;}
.cabecalho .logo{position:absolute;right:${s(53)};top:${s(11)};width:${s(157)};height:${s(157)};background:#fff;}
.cabecalho .logo img{display:block;width:100%;height:100%;object-fit:contain;}
.linha-edicao{padding:${s(10)} ${s(56)} 0;font-size:${s(11)};font-weight:700;letter-spacing:${s(0.4)};color:var(--teal);text-transform:uppercase;white-space:pre-wrap;}
.corpo{padding:${s(24)} ${s(48)} ${s(16)};flex:1 0 auto;}
.titulo-secao{border-left:${s(4)} solid var(--verde-medio);padding:${s(2)} 0 ${s(2)} ${s(24)};margin-bottom:${s(34)};min-height:${s(52)};}
.titulo-secao h1{font-size:${s(22)};font-weight:700;line-height:1.25;color:var(--verde-escuro);}
.titulo-secao p{margin-top:${s(8)};font-size:${s(12.8)};line-height:1.4;color:var(--texto-suave);}
.bloco{margin-bottom:${s(22)};}
.etiqueta{display:inline-block;max-width:100%;padding:${s(8)} ${s(20)};border-radius:${s(8)};background:var(--etiqueta-fundo);color:var(--teal);font-size:${s(10)};font-weight:700;letter-spacing:${s(0.3)};line-height:1.2;text-transform:uppercase;}
.bloco-destaque{background:var(--card-fundo);border:1px solid var(--borda);border-radius:${s(8)};padding:${s(19)} ${s(36)} ${s(18)} ${s(21)};}
.bloco-destaque .texto{padding-right:${s(36)};}
.bloco-destaque h2{margin:${s(32)} 0 0 ${s(8)};font-size:${s(25.4)};font-weight:700;line-height:1.25;color:var(--verde-escuro);}
.bloco-destaque .texto{margin:${s(30)} 0 ${s(16)} ${s(8)};font-size:${s(14)};line-height:1.4;text-align:justify;}
.bloco-destaque .chamada{border-top:1px solid var(--borda);padding:${s(11)} 0 0 ${s(8)};font-size:${s(12)};font-weight:700;line-height:1.4;color:var(--teal);}
.cabeca-grupo{margin:${s(26)} 0 ${s(16)};}
.cabeca-grupo i{display:block;width:${s(33)};height:${s(4)};border-radius:${s(3)};background:var(--verde-medio);}
.cabeca-grupo h2{margin:${s(14)} 0 0 ${s(8)};font-size:${s(21)};font-weight:700;line-height:1.25;color:var(--verde-escuro);}
.grade-cards{display:grid;grid-template-columns:1fr 1fr;gap:${s(29)};margin-bottom:${s(22)};}
.grade-cards .bloco-card{margin:0;}
.bloco-card{background:var(--card-fundo);border:1px solid var(--borda);border-radius:${s(8)};padding:${s(19)} ${s(20)} ${s(24)} ${s(22)};min-width:0;}
.bloco-card.ultimo-impar{grid-column:1 / -1;}
.bloco-card h3{margin-top:${s(18)};padding-right:${s(40)};font-size:${s(17.8)};font-weight:700;line-height:1.4;color:var(--verde-escuro);}
.bloco-card .texto{margin-top:${s(16)};font-size:${s(13)};line-height:1.45;}
.bloco-dica{position:relative;background:var(--teal);color:#fff;border-radius:${s(8)};padding:${s(22)} ${s(60)} ${s(22)} ${s(30)};}
.bloco-dica::before{content:"";position:absolute;left:${s(22)};top:${s(27)};width:${s(12)};height:${s(12)};border-radius:50%;background:var(--amarelo);}
.bloco-dica h3{padding-left:${s(23)};font-size:${s(17)};font-weight:700;line-height:1.35;color:#fff;}
.bloco-dica .texto{margin-top:${s(10)};font-size:${s(13)};line-height:1.5;color:rgba(255,255,255,.92);}
.bloco-texto h3{font-size:${s(17)};font-weight:700;line-height:1.35;color:var(--verde-escuro);}
.bloco-texto .texto{margin-top:${s(8)};font-size:${s(14)};line-height:1.45;}
.vazio{padding:${s(60)} 0;text-align:center;font-size:${s(16)};color:var(--texto-suave);}
.rodape{margin:0 ${s(48)};padding:${s(10)} ${s(8)} ${s(22)};border-top:1px solid var(--borda);display:flex;justify-content:space-between;gap:${s(16)};font-size:${s(10)};color:var(--texto-suave);}
.rodape .esq{font-weight:600;}
.rodape .dir{text-align:right;}
${web ? CSS_WEB : ''}`;
}

module.exports = { buildCss, CORES_PADRAO, VAR_NOME, VAR_VALOR };
