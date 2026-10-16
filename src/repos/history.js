function parseJson(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

// `db` pode ser o pool ou uma conexão de transação.
async function insertEvent(db, edicaoId, usuarioId, acao, detalhe) {
  await db.query(
    'INSERT INTO historico (edicao_id, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)',
    [edicaoId, usuarioId ?? null, acao, detalhe == null ? null : JSON.stringify(detalhe)]
  );
}

function makeHistoryRepo(pool) {
  async function logHistory(edicaoId, usuarioId, acao, detalhe) {
    await insertEvent(pool, edicaoId, usuarioId, acao, detalhe);
  }

  async function listHistory(edicaoId) {
    const [rows] = await pool.query(
      `SELECT h.id, h.edicao_id, h.usuario_id, u.nome AS usuario_nome, h.acao, h.detalhe, h.criado_em
         FROM historico h LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.edicao_id = ? ORDER BY h.criado_em DESC, h.id DESC`,
      [edicaoId]
    );
    return rows.map((r) => ({ ...r, detalhe: parseJson(r.detalhe) }));
  }

  return { logHistory, listHistory };
}

let defaultRepo;
function lazy(nome) {
  return (...args) => {
    if (!defaultRepo) defaultRepo = makeHistoryRepo(require('../db/pool').getPool());
    return defaultRepo[nome](...args);
  };
}

module.exports = {
  makeHistoryRepo,
  insertEvent,
  parseJson,
  logHistory: lazy('logHistory'),
  listHistory: lazy('listHistory'),
};
