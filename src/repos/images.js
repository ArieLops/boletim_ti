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

  return { saveImage, getImage, getMany, countByEdition };
}

module.exports = { makeImagesRepo };
