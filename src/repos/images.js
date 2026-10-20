function makeImagesRepo(pool) {
  async function saveImage(edicaoId, { mime, buffer }) {
    const [r] = await pool.query('INSERT INTO imagens (edicao_id, mime, conteudo) VALUES (?, ?, ?)', [edicaoId, mime, buffer]);
    return r.insertId;
  }

  async function getImage(edicaoId, id) {
    const [rows] = await pool.query('SELECT mime, conteudo FROM imagens WHERE id = ? AND edicao_id = ?', [id, edicaoId]);
    return rows[0] ? { mime: rows[0].mime, buffer: rows[0].conteudo } : null;
  }

  // Só imagens que pertencem à edição; ids alheios ou inexistentes simplesmente não aparecem.
  async function getMany(edicaoId, ids) {
    const lista = [...new Set((ids || []).filter((n) => Number.isInteger(n) && n > 0))];
    if (!lista.length) return {};
    const [rows] = await pool.query('SELECT id, mime, conteudo FROM imagens WHERE edicao_id = ? AND id IN (?)', [edicaoId, lista]);
    const out = {};
    for (const r of rows) out[r.id] = { mime: r.mime, buffer: r.conteudo };
    return out;
  }

  async function countByEdition(edicaoId) {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM imagens WHERE edicao_id = ?', [edicaoId]);
    return Number(rows[0].n);
  }

  // Grava respeitando status e limite de forma atômica: o FOR UPDATE na edição serializa envios
  // simultâneos e a publicação. Devolve {id} ou {conflito: 'publicada' | 'limite'}.
  async function saveImageLimitada(edicaoId, { mime, buffer }, max) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [ed] = await conn.query('SELECT status FROM edicoes WHERE id = ? FOR UPDATE', [edicaoId]);
      if (!ed[0]) {
        await conn.rollback();
        return { conflito: 'inexistente' };
      }
      if (ed[0].status === 'publicada') {
        await conn.rollback();
        return { conflito: 'publicada' };
      }
      const [c] = await conn.query('SELECT COUNT(*) AS n FROM imagens WHERE edicao_id = ?', [edicaoId]);
      if (Number(c[0].n) >= max) {
        await conn.rollback();
        return { conflito: 'limite' };
      }
      const [r] = await conn.query('INSERT INTO imagens (edicao_id, mime, conteudo) VALUES (?, ?, ?)', [edicaoId, mime, buffer]);
      await conn.commit();
      return { id: r.insertId };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return { saveImage, saveImageLimitada, getImage, getMany, countByEdition };
}

module.exports = { makeImagesRepo };
