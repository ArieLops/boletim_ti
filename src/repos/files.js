// Arquivos publicados (PDF e PNGs) guardados no banco, um por (edição, tipo).
const TIPOS_DB = ['pdf', 'png_email', 'png_whatsapp'];

function makeFilesRepo(pool) {
  // `conn` opcional: uma conexão já dentro de uma transação do chamador (publicação atômica).
  // Sem ela, abre a própria transação; em qualquer falha nada é alterado.
  async function saveFiles(edicaoId, userId, { pdf, pngEmail, pngWhatsapp } = {}, conn = null) {
    const itens = [['pdf', pdf], ['png_email', pngEmail], ['png_whatsapp', pngWhatsapp]];
    const proprio = !conn;
    const db = conn || (await pool.getConnection());
    try {
      if (proprio) await db.beginTransaction();
      for (const [tipo, conteudo] of itens) {
        if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw new TypeError(`Arquivo ${tipo} inválido`);
        await db.query(
          `INSERT INTO arquivos_publicados (edicao_id, tipo, conteudo, gerado_por, gerado_em)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE conteudo = VALUES(conteudo), gerado_por = VALUES(gerado_por), gerado_em = CURRENT_TIMESTAMP`,
          [edicaoId, tipo, conteudo, userId ?? null]
        );
      }
      if (proprio) await db.commit();
    } catch (err) {
      if (proprio) await db.rollback();
      throw err;
    } finally {
      if (proprio) db.release();
    }
  }

  async function getFile(edicaoId, tipo) {
    if (!TIPOS_DB.includes(tipo)) return null;
    const [rows] = await pool.query('SELECT conteudo, gerado_em FROM arquivos_publicados WHERE edicao_id = ? AND tipo = ?', [edicaoId, tipo]);
    if (!rows[0]) return null;
    return { conteudo: Buffer.from(rows[0].conteudo), gerado_em: rows[0].gerado_em };
  }

  async function deleteFiles(edicaoId, conn = null) {
    await (conn || pool).query('DELETE FROM arquivos_publicados WHERE edicao_id = ?', [edicaoId]);
  }

  return { saveFiles, getFile, deleteFiles };
}

module.exports = { TIPOS_DB, makeFilesRepo };
