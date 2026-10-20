const fs = require('node:fs');
const path = require('node:path');
const { buildCss } = require('./styles');

const LOGO_PADRAO = {
  buffer: fs.readFileSync(path.join(__dirname, 'assets', 'logo-padrao.png')),
  mime: 'image/png',
};
// Simbolo do SENAR (fixo, canto esquerdo do cabecalho). A logo da direita (conecta TI) e a padrao/configuravel acima.
const LOGO_SENAR_URI = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'logo-senar.png')).toString('base64')}`;
const MIMES_LOGO = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escapa e converte quebras de linha em <br>.
function txt(v) {
  return esc(v).replace(/\r\n|\r|\n/g, '<br>');
}

function linhaEdicao(edicao) {
  const num = String(edicao.numero == null ? '' : edicao.numero).padStart(3, '0');
  const m = /^(\d{4})-(\d{2})$/.exec(String(edicao.mes_ano || ''));
  const mes = m && MESES[Number(m[2]) - 1] ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : String(edicao.mes_ano || '');
  return `TECNOLOGIA DA INFORMAÇÃO · EDIÇÃO ${num} · ${mes}`;
}

function logoUri(logo) {
  const l = logo && Buffer.isBuffer(logo.buffer) && MIMES_LOGO.has(logo.mime) ? logo : LOGO_PADRAO;
  return `data:${l.mime};base64,${l.buffer.toString('base64')}`;
}

function blocoHtml(b) {
  const d = b.dados || {};
  switch (b.tipo) {
    case 'destaque':
      return `<section class="bloco bloco-destaque"><span class="etiqueta">${txt(d.etiqueta)}</span><h2>${txt(d.titulo)}</h2><p class="texto">${txt(d.texto)}</p><p class="chamada">${txt(d.chamada)}</p></section>`;
    case 'dica':
      return `<section class="bloco bloco-dica"><h3>${txt(d.titulo)}</h3><p class="texto">${txt(d.texto)}</p></section>`;
    case 'texto':
      return `<section class="bloco bloco-texto"><h3>${txt(d.titulo)}</h3><p class="texto">${txt(d.texto)}</p></section>`;
    default:
      return '';
  }
}

function cardHtml(b, impar) {
  const d = b.dados || {};
  return `<article class="bloco bloco-card${impar ? ' ultimo-impar' : ''}"><span class="etiqueta">${txt(d.etiqueta)}</span><h3>${txt(d.titulo)}</h3><p class="texto">${txt(d.texto)}</p></article>`;
}

// Cards consecutivos viram uma grade de 2 colunas; o titulo "Atualizações da semana" aparece antes do 1o grupo.
function corpoHtml(blocos) {
  let out = '';
  let primeiroGrupo = true;
  for (let i = 0; i < blocos.length; ) {
    if (blocos[i].tipo === 'card') {
      let j = i;
      while (j < blocos.length && blocos[j].tipo === 'card') j++;
      const grupo = blocos.slice(i, j);
      if (primeiroGrupo) {
        out += '<div class="cabeca-grupo"><i></i><h2>Atualizações da semana</h2></div>';
        primeiroGrupo = false;
      }
      out += `<div class="grade-cards">${grupo.map((c, k) => cardHtml(c, grupo.length % 2 === 1 && k === grupo.length - 1)).join('')}</div>`;
      i = j;
    } else {
      out += blocoHtml(blocos[i]);
      i++;
    }
  }
  return out;
}

function renderEdition({ edicao = {}, blocos = [], settings = {}, logo = null, mode = 'a4', scale = 1, preview = false, barraHtml = '' } = {}) {
  const escala = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const modo = mode === 'strip' || mode === 'web' ? mode : 'a4';
  const cfg = settings || {};
  const rodape = cfg.rodape || 'TI SENAR-RS';
  const email = cfg.emailTi || 'informatica@senar-rs.com.br';
  const subtitulo = edicao.subtitulo || cfg.subtitulo || '';
  const lista = Array.isArray(blocos) ? blocos : [];
  const vazio = lista.length === 0 && preview ? '<div class="vazio">Edição vazia</div>' : '';
  const css = buildCss({ mode: modo, escala, cores: cfg.cores });
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(edicao.titulo || 'Comunicado semanal')}</title><style>${css}</style></head>
<body>${modo === 'web' ? String(barraHtml || '') : ''}<div class="pagina"><div id="conteudo" data-conteudo>
<header class="cabecalho"><div class="topo-barra"></div><div class="logo-senar"><img src="${LOGO_SENAR_URI}" alt="SENAR"></div><div class="logo"><img src="${logoUri(logo)}" alt="SENAR"></div></header>
<div class="linha-edicao">${esc(linhaEdicao(edicao))}</div>
<main class="corpo"><div class="titulo-secao"><h1>${txt(edicao.titulo)}</h1>${subtitulo ? `<p>${txt(subtitulo)}</p>` : ''}</div>${corpoHtml(lista)}${vazio}</main>
<footer class="rodape"><span class="esq">${esc(rodape)}</span><span class="dir">${esc(email)}</span></footer>
</div></div></body></html>`;
}

module.exports = { renderEdition, esc };
