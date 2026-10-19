// Link público do comunicado: /p/<token> (página) e /p/<token>/baixar/<tipo> (arquivos publicados).
// Montado ANTES do Router com sessão (ver app.js): nunca passa por session/csrf/loadUser, então não define
// cookie nem cria linha em `sessions`. Toda resposta deste router leva os cabeçalhos de CSP/no-store abaixo.
const express = require('express');
const { tokenValido } = require('../domain/token');
const { renderEdition, esc } = require('../render/renderEdition');
const { numeroFmt } = require('./common');

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const MSG_429 = 'Muitas tentativas. Aguarde alguns minutos.';

// :tipo da URL -> tipo no banco, Content-Type e sufixo do arquivo (mesmos nomes dos downloads autenticados).
const TIPOS = {
  pdf: { db: 'pdf', mime: 'application/pdf', sufixo: '.pdf', rotulo: 'Baixar PDF (A4)' },
  'png-email': { db: 'png_email', mime: 'image/png', sufixo: '-email.png', rotulo: 'Baixar imagem para e-mail' },
  'png-whatsapp': { db: 'png_whatsapp', mime: 'image/png', sufixo: '-whatsapp.png', rotulo: 'Baixar imagem para WhatsApp' },
};

// Barra de download: só constantes + token já validado + u(); tudo passa por esc().
function barraHtml(u, token) {
  const links = Object.entries(TIPOS)
    .map(([tipo, t]) => `<a href="${esc(u(`/p/${token}/baixar/${tipo}`))}">${esc(t.rotulo)}</a>`)
    .join('');
  return `<nav class="barra-publica" aria-label="Baixar o comunicado">${links}</nav>`;
}

function publicRoutes({ throttle } = {}) {
  const r = express.Router({ caseSensitive: true });
  const limite = (req) => throttle || req.app.locals.publicThrottle;

  // Cabeçalhos de toda resposta sob /p e bloqueio por IP (antes de qualquer consulta ao banco).
  r.use('/p', (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP,
    });
    if (limite(req).bloqueado(req.ip)) return res.status(429).type('text').send(MSG_429);
    next();
  });

  const aviso = (res, status, titulo, mensagem) => res.status(status).render('publico-aviso', { titulo, mensagem });
  // Formato inválido e token desconhecido: mesma resposta, e ambos contam como falha do IP.
  const naoEncontrado = (req, res) => {
    limite(req).registrarFalha(req.ip);
    return aviso(res, 404, 'Link não encontrado', 'Confira se o endereço foi copiado por inteiro.');
  };
  // 404 sem contar falha (tipo desconhecido, edição em revisão, arquivo ausente): corpo idêntico.
  const semArquivo = (res) => aviso(res, 404, 'Link não encontrado', 'Confira se o endereço foi copiado por inteiro.');

  r.get('/p/:token', async (req, res) => {
    const { token } = req.params;
    if (!tokenValido(token)) return naoEncontrado(req, res);
    const dados = await req.app.locals.editions.getByToken(token);
    if (!dados) return naoEncontrado(req, res);
    if (dados.edicao.status !== 'publicada') {
      return aviso(res, 200, 'Comunicado em revisão', 'Este comunicado está em revisão. Volte em instantes.');
    }
    const { settings } = req.app.locals;
    const [cfg, logo] = await Promise.all([settings.getSettings(), settings.getLogo()]);
    res.type('html').send(
      renderEdition({ edicao: dados.edicao, blocos: dados.blocos, settings: cfg, logo, mode: 'web', barraHtml: barraHtml(res.locals.u, token) })
    );
  });

  r.get('/p/:token/baixar/:tipo', async (req, res) => {
    const { token, tipo } = req.params;
    if (!tokenValido(token)) return naoEncontrado(req, res);
    const dados = await req.app.locals.editions.getByToken(token);
    if (!dados) return naoEncontrado(req, res);
    const t = Object.hasOwn(TIPOS, tipo) ? TIPOS[tipo] : null;
    if (!t || dados.edicao.status !== 'publicada') return semArquivo(res);
    const f = await req.app.locals.files.getFile(dados.edicao.id, t.db);
    if (!f) return semArquivo(res);
    res.set({
      'Content-Type': t.mime,
      'Content-Disposition': `attachment; filename="comunicado-${numeroFmt(dados.edicao.numero)}${t.sufixo}"`,
    });
    res.send(f.conteudo);
  });

  // Percent-encoding inválido no token (ex.: /p/%E0%A4%A): o Express falha com 400 antes do handler.
  // Tratado como token malformado (mesma 404, conta como falha); outros erros seguem para o tratador geral.
  r.use('/p', (err, req, res, next) => {
    if (err && err.status === 400 && err instanceof URIError) return naoEncontrado(req, res);
    next(err);
  });

  return r;
}

module.exports = { publicRoutes };
