// Lógica pura do editor (sem DOM), testável com node:test. No navegador expõe window.EditorLib.
(function (raiz, fabrica) {
  const lib = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.EditorLib = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  const CAMPOS = {
    destaque: ['etiqueta', 'titulo', 'texto', 'chamada'],
    card: ['etiqueta', 'titulo', 'texto'],
    dica: ['titulo', 'texto'],
    texto: ['titulo', 'texto'],
  };
  const LIMITE_CAMPO = 2000;
  const MES_ANO = /^\d{4}-(0[1-9]|1[0-2])$/;
  const MSG_503 = 'Exportação indisponível no servidor. Avise a TI.';

  // Nova lista com o item de `indice` deslocado `delta` posições (fora dos limites: cópia igual).
  function mover(lista, indice, delta) {
    const copia = lista.slice();
    const destino = indice + delta;
    if (!Number.isInteger(indice) || indice < 0 || indice >= copia.length || destino < 0 || destino >= copia.length) return copia;
    const [item] = copia.splice(indice, 1);
    copia.splice(destino, 0, item);
    return copia;
  }

  // Valor do cabeçalho X-Ajuste -> texto do indicador.
  function textoAjuste(valor) {
    if (valor === 'limite') return { texto: 'passou do limite', classe: 'limite', limite: true };
    if (/^\d{1,3}$/.test(String(valor))) {
      const n = Number(valor);
      return n >= 100
        ? { texto: '100%', classe: 'ok', limite: false }
        : { texto: `reduzido a ${n}%`, classe: 'reduzido', limite: false };
    }
    return { texto: 'indisponível', classe: 'indisponivel', limite: false };
  }

  // Corpo do PUT /edicoes/:id; bloco novo (sem id) não envia a chave `id`.
  function serializar({ versao, campos, blocos }) {
    return {
      versao,
      campos: { ...campos },
      blocos: blocos.map((b) => {
        const o = { tipo: b.tipo, dados: { ...b.dados } };
        if (b.id != null) o.id = b.id;
        return o;
      }),
    };
  }

  // Espelha as regras do servidor para não enviar rascunhos incompletos (evita 400 a cada tecla).
  function validarLocal(payload) {
    const erros = [];
    const c = payload.campos || {};
    if (!String(c.titulo || '').trim()) erros.push('Informe o título da edição.');
    if (!MES_ANO.test(String(c.mesAno || ''))) erros.push('Informe o mês/ano no formato AAAA-MM.');
    payload.blocos.forEach((b, i) => {
      for (const campo of CAMPOS[b.tipo] || []) {
        const v = String((b.dados || {})[campo] || '').trim();
        if (!v) erros.push(`Bloco ${i + 1}: preencha o campo ${campo}.`);
        else if (v.length > LIMITE_CAMPO) erros.push(`Bloco ${i + 1}: o campo ${campo} excede ${LIMITE_CAMPO} caracteres.`);
      }
    });
    return erros;
  }

  // Resposta de erro da API -> o que a interface deve fazer.
  function classificarErro(status, corpo) {
    const msg = corpo && typeof corpo.erro === 'string' ? corpo.erro : '';
    if (status === 401) return { tipo: 'sessao', mensagem: 'Sessão expirada. Entre novamente.' };
    if (status === 409) {
      if (/publicada/i.test(msg)) return { tipo: 'publicada', mensagem: msg };
      if (/cortado/i.test(msg)) return { tipo: 'cortado', mensagem: msg };
      return { tipo: 'conflito', mensagem: msg || 'A edição foi alterada por outra pessoa. Recarregue.' };
    }
    if (status === 400) return { tipo: 'validacao', mensagem: msg || 'Dados inválidos.' };
    if (status === 503) return { tipo: 'indisponivel', mensagem: MSG_503 };
    return { tipo: 'outro', mensagem: msg || `Erro inesperado (${status}).` };
  }

  const precisaConfirmarCorte = (tipo, ajuste) => ajuste === 'limite' && (tipo === 'pdf' || tipo === 'png-email');

  function nomeArquivo(contentDisposition, padrao) {
    const m = /filename="?([^";]+)"?/i.exec(contentDisposition || '');
    return m ? m[1] : padrao;
  }

  return { CAMPOS, LIMITE_CAMPO, MSG_503, mover, textoAjuste, serializar, validarLocal, classificarErro, precisaConfirmarCorte, nomeArquivo };
});
