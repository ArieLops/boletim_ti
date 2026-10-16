const express = require('express');
const { requireLogin } = require('../auth/middleware');
const { ConflictError } = require('../repos/editions');
const { validateBlock } = require('../domain/blocks');
const { renderEdition } = require('../render/renderEdition');
const { erro, carregarEdicao, exportador, contextoExport, ExportUnavailableError } = require('./common');

const MES_ANO = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_TITULO = 255;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const textoNaoVazio = (v) => typeof v === 'string' && v.trim().length > 0;

function validarCriacao(b) {
  if (!ehObjeto(b)) return { erro: 'corpo inválido' };
  if (b.numero !== undefined && !(Number.isInteger(b.numero) && b.numero > 0 && b.numero <= 2147483647)) return { erro: 'número deve ser um inteiro positivo' };
  if (typeof b.mesAno !== 'string' || !MES_ANO.test(b.mesAno)) return { erro: 'mesAno deve estar no formato AAAA-MM' };
  if (!textoNaoVazio(b.titulo) || b.titulo.trim().length > MAX_TITULO) return { erro: `título é obrigatório (até ${MAX_TITULO} caracteres)` };
  if (b.subtitulo != null && (typeof b.subtitulo !== 'string' || b.subtitulo.length > MAX_TITULO)) return { erro: `subtítulo deve ser texto (até ${MAX_TITULO} caracteres)` };
  return {
    ok: { numero: b.numero, mesAno: b.mesAno, titulo: b.titulo.trim(), subtitulo: b.subtitulo ? b.subtitulo.trim() || null : null },
  };
}

function validarSalvamento(b) {
  if (!ehObjeto(b)) return { erro: 'corpo inválido' };
  if (!Number.isInteger(b.versao)) return { erro: 'versao deve ser um inteiro' };
  if (!Array.isArray(b.blocos)) return { erro: 'blocos deve ser uma lista' };
  const campos = b.campos === undefined ? {} : b.campos;
  if (!ehObjeto(campos)) return { erro: 'campos deve ser um objeto' };
  const c = {};
  if (campos.titulo !== undefined) {
    if (!textoNaoVazio(campos.titulo) || campos.titulo.trim().length > MAX_TITULO) return { erro: `título deve ser um texto não vazio (até ${MAX_TITULO} caracteres)` };
    c.titulo = campos.titulo.trim();
  }
  if (campos.mesAno !== undefined) {
    if (typeof campos.mesAno !== 'string' || !MES_ANO.test(campos.mesAno)) return { erro: 'mesAno deve estar no formato AAAA-MM' };
    c.mesAno = campos.mesAno;
  }
  if (campos.subtitulo !== undefined) {
    if (campos.subtitulo !== null && (typeof campos.subtitulo !== 'string' || campos.subtitulo.length > MAX_TITULO)) return { erro: `subtítulo deve ser texto (até ${MAX_TITULO} caracteres)` };
    c.subtitulo = campos.subtitulo ? campos.subtitulo.trim() || null : null;
  }
  const vistos = new Set();
  const blocos = [];
  for (let i = 0; i < b.blocos.length; i++) {
    const bl = b.blocos[i];
    if (!ehObjeto(bl)) return { erro: `bloco ${i + 1} inválido: deve ser um objeto` };
    let id = null;
    if (bl.id != null) {
      if (!Number.isInteger(bl.id) || bl.id <= 0) return { erro: `bloco ${i + 1} inválido: id deve ser um inteiro positivo` };
      if (vistos.has(bl.id)) return { erro: `bloco ${i + 1} inválido: id ${bl.id} repetido` };
      vistos.add(bl.id);
      id = bl.id;
    }
    const v = validateBlock(bl.tipo, bl.dados);
    if (!v.ok) return { erro: `bloco ${i + 1} inválido: ${v.errors.join('; ')}` };
    blocos.push({ id, tipo: bl.tipo, dados: bl.dados });
  }
  return { ok: { versao: b.versao, campos: c, blocos } };
}

// Escala do fit -> valor do cabeçalho X-Ajuste ("100", "88", ..., "limite").
const rotuloAjuste = (fit) => (fit.estouro ? 'limite' : String(Math.round(fit.scale * 100)));

function editionsRoutes() {
  const r = express.Router();
  r.use('/edicoes', requireLogin);

  r.post('/edicoes', async (req, res) => {
    const v = validarCriacao(req.body);
    if (!v.ok) return erro(res, 400, v.erro);
    const { editions } = req.app.locals;
    const numero = v.ok.numero ?? (await editions.nextNumber());
    try {
      const id = await editions.createEdition({ ...v.ok, numero }, req.user.id);
      res.status(201).json({ id });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return erro(res, 409, 'já existe uma edição com esse número');
      throw e;
    }
  });

  r.put('/edicoes/:id', carregarEdicao, async (req, res) => {
    const v = validarSalvamento(req.body);
    if (!v.ok) return erro(res, 400, v.erro);
    const { edicao } = req.dados;
    if (edicao.status === 'publicada') return erro(res, 409, 'edição publicada; reabra para editar');
    try {
      const versao = await req.app.locals.editions.saveEdition(edicao.id, v.ok, req.user.id);
      // Devolve também os ids dos blocos (na ordem enviada) para o editor manter a identidade dos novos.
      const atual = await req.app.locals.editions.getEdition(edicao.id);
      const resposta = { versao };
      if (atual && atual.edicao.versao === versao && atual.blocos.length === v.ok.blocos.length) {
        resposta.blocos = atual.blocos.map((b) => ({ id: b.id }));
      }
      res.json(resposta);
    } catch (e) {
      if (e instanceof ConflictError) return erro(res, 409, `esta edição foi alterada por ${e.por}, recarregue`);
      // Publicada entre a checagem acima e o salvamento (corrida).
      if (/publicada não pode ser alterada/.test(e.message)) return erro(res, 409, 'edição publicada; reabra para editar');
      throw e;
    }
  });

  // Prévia HTML na escala escolhida pelo fit. Sem Chromium a prévia ainda funciona (escala 1).
  r.get('/edicoes/:id/preview', carregarEdicao, async (req, res) => {
    const { input, opts } = await contextoExport(req);
    let scale = 1;
    let ajuste = 'indisponivel';
    try {
      const fit = await exportador(req).fit(input, opts);
      scale = fit.scale;
      ajuste = rotuloAjuste(fit);
    } catch (e) {
      if (!(e instanceof ExportUnavailableError)) throw e;
    }
    res
      .set('X-Ajuste', ajuste)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(renderEdition({ ...input, mode: 'a4', scale, preview: true }));
  });

  return r;
}

module.exports = { editionsRoutes, rotuloAjuste };
