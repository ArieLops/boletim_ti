// Limitador de tentativas de login em memória: `max` falhas dentro de
// `janelaMs` bloqueiam a chave (login + ip) até as falhas saírem da janela.
function createThrottle({ max = 5, janelaMs = 15 * 60 * 1000, agora = Date.now } = {}) {
  const falhas = new Map();

  function recentes(chave) {
    const limite = agora() - janelaMs;
    const lista = (falhas.get(chave) || []).filter((t) => t > limite);
    if (lista.length) falhas.set(chave, lista);
    else falhas.delete(chave);
    return lista;
  }

  return {
    registrarFalha(chave) {
      const lista = recentes(chave);
      lista.push(agora());
      falhas.set(chave, lista);
      if (falhas.size > 10000) {
        for (const k of [...falhas.keys()]) recentes(k);
      }
    },
    bloqueado(chave) {
      return recentes(chave).length >= max;
    },
    limpar(chave) {
      falhas.delete(chave);
    },
  };
}

module.exports = { createThrottle };
