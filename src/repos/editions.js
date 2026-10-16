const { validateBlock } = require('../domain/blocks');
const { diffBlocks } = require('../domain/diff');
const { insertEvent, parseJson } = require('./history');

const STATUS = ['rascunho', 'publicada'];

class ConflictError extends Error {
  constructor(por) {
    super(`Esta edição foi alterada por ${por}. Recarregue a página para ver a versão mais recente.`);
    this.name = 'ConflictError';
    this.por = por;
  }
}

const mapBloco = (r) => ({ id: r.id, tipo: r.tipo, ordem: r.ordem, dados: parseJson(r.dados) });

function makeEditionsRepo(pool) {
  async function nextNumber() {
    const [rows] = await pool.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM edicoes');
    return Number(rows[0].n);
  }

  async function createEdition({ numero, mesAno, titulo, subtitulo }, userId) {
    const [r] = await pool.query(
      'INSERT INTO edicoes (numero, mes_ano, titulo, subtitulo, criado_por, atualizado_por) VALUES (?, ?, ?, ?, ?, ?)',
      [numero, mesAno, titulo, subtitulo ?? null, userId, userId]
    );
    await insertEvent(pool, r.insertId, userId, 'edicao_criada', { numero, titulo });
    return r.insertId;
  }

  async function getEdition(id) {
    const [rows] = await pool.query('SELECT * FROM edicoes WHERE id = ?', [id]);
    if (!rows[0]) return null;
    const [blocos] = await pool.query('SELECT * FROM blocos WHERE edicao_id = ? ORDER BY ordem, id', [id]);
    return { edicao: rows[0], blocos: blocos.map(mapBloco) };
  }

  async function listEditions() {
    const [rows] = await pool.query(
      `SELECT e.*, u.nome AS atualizado_por_nome
         FROM edicoes e LEFT JOIN usuarios u ON u.id = e.atualizado_por
        ORDER BY e.numero DESC`
    );
    return rows;
  }

  // Blocos mantêm o id quando o chamador o devolve (UPDATE); novos são inseridos; ausentes são apagados.
  async function saveEdition(id, { versao, campos = {}, blocos = [], token }, userId) {
    const validados = blocos.map((b, i) => {
      const v = validateBlock(b.tipo, b.dados);
      if (!v.ok) throw new Error(`Bloco ${i} inválido: ${v.errors.join('; ')}`);
      return { id: b.id == null ? null : Number(b.id), tipo: b.tipo, dados: v.dados };
    });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM edicoes WHERE id = ? FOR UPDATE', [id]);
      const atual = rows[0];
      if (!atual) throw new Error('Edição não encontrada');
      if (atual.status === 'publicada') throw new Error('Edição publicada não pode ser alterada');
      if (Number(versao) !== atual.versao) {
        const [u] = await conn.query('SELECT nome FROM usuarios WHERE id = ?', [atual.atualizado_por]);
        throw new ConflictError(u[0] ? u[0].nome : 'outro editor');
      }

      const [antesRows] = await conn.query('SELECT * FROM blocos WHERE edicao_id = ? ORDER BY ordem, id', [id]);
      const antes = antesRows.map(mapBloco);
      const idsAntes = new Set(antes.map((b) => b.id));
      // Ids que não pertencem a esta edição são ignorados (bloco tratado como novo).
      const depois = validados.map((b) => ({ ...b, id: b.id != null && idsAntes.has(b.id) ? b.id : null }));
      const mantidos = new Set(depois.filter((b) => b.id != null).map((b) => b.id));

      const eventos = diffBlocks(antes, depois);

      const remover = antes.filter((b) => !mantidos.has(b.id)).map((b) => b.id);
      if (remover.length) await conn.query('DELETE FROM blocos WHERE edicao_id = ? AND id IN (?)', [id, remover]);

      for (let i = 0; i < depois.length; i++) {
        const b = depois[i];
        const dados = JSON.stringify(b.dados);
        if (b.id != null) {
          await conn.query('UPDATE blocos SET tipo = ?, ordem = ?, dados = ? WHERE id = ? AND edicao_id = ?', [
            b.tipo, i, dados, b.id, id,
          ]);
        } else {
          await conn.query('INSERT INTO blocos (edicao_id, tipo, ordem, dados) VALUES (?, ?, ?, ?)', [id, b.tipo, i, dados]);
        }
      }

      const novaVersao = atual.versao + 1;
      await conn.query(
        'UPDATE edicoes SET titulo = ?, mes_ano = ?, subtitulo = ?, versao = ?, atualizado_por = ? WHERE id = ?',
        [
          campos.titulo ?? atual.titulo,
          campos.mesAno ?? atual.mes_ano,
          campos.subtitulo !== undefined ? campos.subtitulo : atual.subtitulo,
          novaVersao,
          userId,
          id,
        ]
      );

      for (const e of eventos) {
        await insertEvent(conn, id, userId, e.acao, { blocoId: e.blocoId, titulo: e.titulo });
      }
      await insertEvent(conn, id, userId, 'edicao_salva', token ? { versao: novaVersao, token } : { versao: novaVersao });

      await conn.commit();
      return novaVersao;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Idempotência: se o ÚLTIMO salvamento da edição carrega este token e produziu a versão atual, a requisição
  // é a repetição de um save já confirmado (resposta perdida). Devolve a versão atual; senão null.
  async function findRepeatedSave(id, token) {
    if (typeof token !== 'string' || !token) return null;
    const [ed] = await pool.query('SELECT versao, status FROM edicoes WHERE id = ?', [id]);
    if (!ed[0] || ed[0].status === 'publicada') return null;
    const [ev] = await pool.query(
      "SELECT detalhe FROM historico WHERE edicao_id = ? AND acao = 'edicao_salva' ORDER BY id DESC LIMIT 1",
      [id]
    );
    const d = ev[0] ? parseJson(ev[0].detalhe) : null;
    return d && d.token === token && d.versao === ed[0].versao ? ed[0].versao : null;
  }

  async function setStatus(id, status, userId) {
    if (!STATUS.includes(status)) throw new Error('Status inválido');
    const [r] = await pool.query('UPDATE edicoes SET status = ?, atualizado_por = ? WHERE id = ?', [status, userId, id]);
    if (!r.affectedRows) throw new Error('Edição não encontrada');
    await insertEvent(pool, id, userId, 'status_alterado', { status });
  }

  return { nextNumber, createEdition, getEdition, listEditions, saveEdition, findRepeatedSave, setStatus };
}

let defaultRepo;
function lazy(nome) {
  return (...args) => {
    if (!defaultRepo) defaultRepo = makeEditionsRepo(require('../db/pool').getPool());
    return defaultRepo[nome](...args);
  };
}

module.exports = {
  STATUS,
  ConflictError,
  makeEditionsRepo,
  nextNumber: lazy('nextNumber'),
  createEdition: lazy('createEdition'),
  getEdition: lazy('getEdition'),
  listEditions: lazy('listEditions'),
  saveEdition: lazy('saveEdition'),
  findRepeatedSave: lazy('findRepeatedSave'),
  setStatus: lazy('setStatus'),
};
