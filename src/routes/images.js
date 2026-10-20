const express = require('express');
const { requireLogin } = require('../auth/middleware');
const { detectarMime, MAX_BYTES, MAX_POR_EDICAO } = require('../domain/imagem');
const { erro, carregarEdicao } = require('./common');

const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

function imagesRoutes() {
  const r = express.Router();

  // Corpo binário cru (PNG/JPEG/WebP até 2 MB). O tipo real vem da assinatura do conteúdo.
  r.post(
    '/edicoes/:id/imagens',
    requireLogin,
    carregarEdicao,
    express.raw({ type: TIPOS, limit: MAX_BYTES }),
    async (req, res) => {
      const { edicao } = req.dados;
      if (edicao.status === 'publicada') return erro(res, 409, 'edição publicada; reabra para editar');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return erro(res, 415, 'envie uma imagem PNG, JPEG ou WebP');
      const mime = detectarMime(req.body);
      if (!mime) return erro(res, 415, 'o arquivo não é uma imagem PNG, JPEG ou WebP');
      const r = await req.app.locals.images.saveImageLimitada(edicao.id, { mime, buffer: req.body }, MAX_POR_EDICAO);
      if (r.conflito === 'publicada') return erro(res, 409, 'edição publicada; reabra para editar');
      if (r.conflito === 'limite') return erro(res, 409, `esta edição já tem ${MAX_POR_EDICAO} imagens (o máximo)`);
      if (r.conflito) return erro(res, 404, 'edição não encontrada');
      res.status(201).json({ id: r.id });
    }
  );

  r.get('/edicoes/:id/imagens/:imagemId', requireLogin, carregarEdicao, async (req, res) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.imagemId)) return erro(res, 404, 'imagem não encontrada');
    const img = await req.app.locals.images.getImage(req.dados.edicao.id, Number(req.params.imagemId));
    if (!img) return erro(res, 404, 'imagem não encontrada');
    res
      .set({ 'Content-Type': img.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' })
      .send(img.buffer);
  });

  return r;
}

module.exports = { imagesRoutes };
