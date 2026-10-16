// Configurações (chave/valor) e logo (linha única id=1).
const PADROES = {
  emailTi: 'informatica@senar-rs.com.br',
  rodape: 'TI SENAR-RS',
  subtitulo: 'Avisos rápidos, melhorias e orientações para as equipes do SENAR-RS.',
  pisoReducao: 0.75,
  cores: {},
};

function interpretar(chave, bruto) {
  if (bruto == null) return PADROES[chave];
  if (chave === 'pisoReducao') {
    const n = Number(bruto);
    return Number.isFinite(n) && n >= 0.5 && n <= 1 ? n : PADROES.pisoReducao;
  }
  if (chave === 'cores') {
    try {
      const o = JSON.parse(bruto);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return String(bruto);
}

function makeSettingsRepo(pool) {
  async function getSettings() {
    const [rows] = await pool.query('SELECT chave, valor FROM configuracoes');
    const brutos = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    const out = {};
    for (const k of Object.keys(PADROES)) out[k] = interpretar(k, brutos[k]);
    return out;
  }

  async function setSettings(obj) {
    const entradas = Object.entries(obj || {}).filter(([k]) => k in PADROES);
    for (const [chave, valor] of entradas) {
      const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
      await pool.query('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [chave, texto]);
    }
  }

  async function getLogo() {
    const [rows] = await pool.query('SELECT conteudo, mime FROM logo WHERE id = 1');
    return rows[0] ? { buffer: Buffer.from(rows[0].conteudo), mime: rows[0].mime } : null;
  }

  async function setLogo(buffer, mime) {
    await pool.query('INSERT INTO logo (id, conteudo, mime) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE conteudo = VALUES(conteudo), mime = VALUES(mime)', [buffer, mime]);
  }

  return { getSettings, setSettings, getLogo, setLogo };
}

module.exports = { PADROES, makeSettingsRepo };
