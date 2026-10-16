const express = require('express');
const { requireLogin, requireAdmin } = require('../auth/middleware');
const { VAR_NOME, VAR_VALOR } = require('../render/styles');
const { erro } = require('./common');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CORES = 50;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const ASSINATURAS = {
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

// Só chaves conhecidas; as demais são ignoradas. Retorna {ok: valores} ou {erro}.
function validarConfig(b) {
  if (!ehObjeto(b)) return { erro: 'corpo inválido' };
  const ok = {};
  if (b.emailTi !== undefined) {
    if (typeof b.emailTi !== 'string' || b.emailTi.length > 200 || !EMAIL.test(b.emailTi.trim())) return { erro: 'e-mail inválido' };
    ok.emailTi = b.emailTi.trim();
  }
  if (b.rodape !== undefined) {
    if (typeof b.rodape !== 'string' || !b.rodape.trim() || b.rodape.length > 200) return { erro: 'rodapé deve ser um texto não vazio (até 200 caracteres)' };
    ok.rodape = b.rodape.trim();
  }
  if (b.subtitulo !== undefined) {
    if (typeof b.subtitulo !== 'string' || b.subtitulo.length > 300) return { erro: 'subtítulo deve ser texto (até 300 caracteres)' };
    ok.subtitulo = b.subtitulo.trim();
  }
  if (b.pisoReducao !== undefined) {
    if (typeof b.pisoReducao !== 'number' || !Number.isFinite(b.pisoReducao) || b.pisoReducao < 0.5 || b.pisoReducao > 1) return { erro: 'pisoReducao deve ser um número entre 0,5 e 1' };
    ok.pisoReducao = b.pisoReducao;
  }
  if (b.cores !== undefined) {
    if (!ehObjeto(b.cores)) return { erro: 'cores deve ser um objeto nome -> valor' };
    const entradas = Object.entries(b.cores);
    if (entradas.length > MAX_CORES) return { erro: `no máximo ${MAX_CORES} cores` };
    const cores = {};
    for (const [k, v] of entradas) {
      if (!VAR_NOME.test(k)) return { erro: `nome de cor inválido: ${k}` };
      if (typeof v !== 'string' || !v.trim() || !VAR_VALOR.test(v)) return { erro: `valor de cor inválido para ${k}` };
      cores[k] = v.trim();
    }
    ok.cores = cores;
  }
  return { ok };
}

function settingsRoutes() {
  const r = express.Router();
  r.use('/api/configuracoes', requireLogin, requireAdmin);

  r.get('/api/configuracoes', async (req, res) => {
    res.json(await req.app.locals.settings.getSettings());
  });

  r.post('/api/configuracoes', async (req, res) => {
    const v = validarConfig(req.body);
    if (!v.ok) return erro(res, 400, v.erro);
    const { settings } = req.app.locals;
    await settings.setSettings(v.ok);
    res.json(await settings.getSettings());
  });

  r.get('/api/configuracoes/logo', async (req, res) => {
    const logo = await req.app.locals.settings.getLogo();
    if (!logo) return erro(res, 404, 'nenhum logo enviado');
    res.set({ 'Content-Type': logo.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(logo.buffer);
  });

  // Corpo binário cru (PNG/JPEG, até 2 MB). SVG e demais tipos não são aceitos.
  r.put('/api/configuracoes/logo', express.raw({ type: ['image/png', 'image/jpeg'], limit: '2mb' }), async (req, res) => {
    const mime = req.is(['image/png', 'image/jpeg']);
    if (!mime) return erro(res, 415, 'envie o logo como image/png ou image/jpeg');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return erro(res, 400, 'arquivo vazio');
    if (!ASSINATURAS[mime](req.body)) return erro(res, 400, 'o conteúdo não corresponde ao tipo de imagem informado');
    await req.app.locals.settings.setLogo(req.body, mime);
    res.json({ mime, bytes: req.body.length });
  });

  return r;
}

module.exports = { settingsRoutes, validarConfig };
