const express = require('express');
const { requireLogin } = require('../auth/middleware');
const { insertEvent } = require('../repos/history');
const tokenPublico = require('../domain/token');
const { erro, carregarEdicao, exportador, contextoExport, numeroFmt, trataExportador } = require('./common');

const TENTATIVAS_TOKEN = 3;

// :tipo da URL -> tipo no banco, Content-Type, sufixo do arquivo e se depende do ajuste A4.
const TIPOS = {
  pdf: { db: 'pdf', mime: 'application/pdf', sufixo: '.pdf', a4: true, gerar: (ex, i, o) => ex.pdf(i, o) },
  'png-email': { db: 'png_email', mime: 'image/png', sufixo: '-email.png', a4: true, gerar: (ex, i, o) => ex.pngEmail(i, o) },
  'png-whatsapp': { db: 'png_whatsapp', mime: 'image/png', sufixo: '-whatsapp.png', a4: true, gerar: (ex, i, o) => ex.pngWhatsapp(i, o) },
};

const confirmou = (req) => String(req.query.confirmar ?? (req.body && req.body.confirmar) ?? '') === '1';
const MSG_CORTADO = 'conteúdo será cortado';

// Publicação atômica: arquivos + status + token + histórico na mesma transação (ou nada muda).
// Devolve { falha } (status/msg) ou { token }.
async function publicarTx(req, edicao, arquivos, fit) {
  const { pool, files } = req.app.locals;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT status, versao, token_publico FROM edicoes WHERE id = ? FOR UPDATE', [edicao.id]);
    const atual = rows[0];
    let falha = null;
    if (!atual) falha = { status: 404, msg: 'edição não encontrada' };
    else if (atual.status === 'publicada') falha = { status: 409, msg: 'edição já publicada' };
    else if (atual.versao !== edicao.versao) falha = { status: 409, msg: 'a edição foi alterada durante a publicação; tente novamente' };
    if (falha) {
      await conn.rollback();
      return { falha };
    }
    await files.saveFiles(edicao.id, req.user.id, arquivos, conn);
    // O token é criado só na primeira publicação e nunca muda (reabrir não o apaga). O índice único é a
    // rede de segurança contra colisão: nesse caso (praticamente impossível) sorteia outro, até 3 vezes.
    let token = atual.token_publico;
    const criado = !token;
    if (criado) {
      for (let tentativa = 1; ; tentativa++) {
        token = tokenPublico.novoToken();
        try {
          await conn.query("UPDATE edicoes SET status = 'publicada', atualizado_por = ?, token_publico = ? WHERE id = ?", [req.user.id, token, edicao.id]);
          break;
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY' || tentativa >= TENTATIVAS_TOKEN) throw err;
        }
      }
    } else {
      await conn.query("UPDATE edicoes SET status = 'publicada', atualizado_por = ? WHERE id = ?", [req.user.id, edicao.id]);
    }
    await insertEvent(conn, edicao.id, req.user.id, 'publicada', { numero: edicao.numero, escala: fit.scale, estouro: fit.estouro });
    if (criado) await insertEvent(conn, edicao.id, req.user.id, 'link_publico_criado', { numero: edicao.numero });
    await conn.commit();
    return { token };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function reabrirTx(req, id) {
  const { pool, files } = req.app.locals;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT status FROM edicoes WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) {
      await conn.rollback();
      return { status: 404, msg: 'edição não encontrada' };
    }
    if (rows[0].status !== 'publicada') {
      await conn.rollback();
      return { status: 409, msg: 'edição já está em rascunho' };
    }
    await files.deleteFiles(id, conn);
    await conn.query("UPDATE edicoes SET status = 'rascunho', atualizado_por = ? WHERE id = ?", [req.user.id, id]);
    await insertEvent(conn, id, req.user.id, 'reaberta', null);
    await conn.commit();
    return null;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

function enviar(res, edicao, t, buffer) {
  res.set({
    'Content-Type': t.mime,
    'Content-Disposition': `attachment; filename="comunicado-${numeroFmt(edicao.numero)}${t.sufixo}"`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}

function exportsRoutes() {
  const r = express.Router();
  r.use('/edicoes', requireLogin);

  r.post('/edicoes/:id/publicar', carregarEdicao, async (req, res) => {
    const { edicao } = req.dados;
    if (edicao.status === 'publicada') return erro(res, 409, 'edição já publicada');
    const { input, opts } = await contextoExport(req);
    let fit;
    let arquivos;
    try {
      const ex = exportador(req);
      fit = await ex.fit(input, opts);
      if (fit.estouro && !confirmou(req)) return erro(res, 409, MSG_CORTADO, { faltaMm: fit.faltaMm });
      const pdf = await ex.pdf(input, opts);
      const pngEmail = await ex.pngEmail(input, opts);
      const pngWhatsapp = await ex.pngWhatsapp(input, opts);
      arquivos = { pdf, pngEmail, pngWhatsapp };
    } catch (e) {
      if (trataExportador(res, e)) return;
      console.error('Falha ao gerar os arquivos da publicação:', e);
      return erro(res, 503, 'Não foi possível gerar os arquivos agora. Tente novamente ou avise a TI.');
    }
    const { falha, token } = await publicarTx(req, edicao, arquivos, fit);
    if (falha) return erro(res, falha.status, falha.msg);
    res.json({ status: 'publicada', token });
  });

  r.post('/edicoes/:id/reabrir', carregarEdicao, async (req, res) => {
    const falha = await reabrirTx(req, req.dados.edicao.id);
    if (falha) return erro(res, falha.status, falha.msg);
    res.json({ status: 'rascunho' });
  });

  r.get('/edicoes/:id/download/:tipo', carregarEdicao, async (req, res) => {
    const t = Object.hasOwn(TIPOS, req.params.tipo) ? TIPOS[req.params.tipo] : null;
    if (!t) return erro(res, 404, 'tipo de arquivo desconhecido');
    const { edicao } = req.dados;
    const { files, history } = req.app.locals;

    let buffer = null;
    if (edicao.status === 'publicada') {
      const f = await files.getFile(edicao.id, t.db);
      if (f) {
        buffer = f.conteudo;
      }
    }
    if (!buffer) {
      const { input, opts } = await contextoExport(req);
      try {
        const ex = exportador(req);
        if (t.a4) {
          const fit = await ex.fit(input, opts);
          if (fit.estouro && !confirmou(req)) return erro(res, 409, MSG_CORTADO, { faltaMm: fit.faltaMm });
        }
        buffer = await t.gerar(ex, input, opts);
      } catch (e) {
        if (trataExportador(res, e)) return;
        throw e;
      }
    }
    await history.logHistory(edicao.id, req.user.id, 'baixou', { tipo: req.params.tipo });
    enviar(res, edicao, t, buffer);
  });

  return r;
}

module.exports = { exportsRoutes };
