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

  // Quanto falta cortar (cabeçalho X-Falta-Mm ou campo faltaMm): "12,3 mm", ou '' se ausente/inválido/zero.
  function faltaTexto(valor) {
    const n = typeof valor === 'number' ? valor : /^\d+(\.\d+)?$/.test(String(valor == null ? '' : valor).trim()) ? Number(valor) : NaN;
    return Number.isFinite(n) && n > 0 && n.toFixed(1) !== '0.0' ? n.toFixed(1).replace('.', ',') + ' mm' : '';
  }

  // Aviso de corte para os diálogos de download/publicação.
  function textoCorte(faltaMm) {
    const f = faltaTexto(faltaMm);
    return 'O conteúdo será cortado' + (f ? ` (faltam ${f})` : '');
  }

  // Valor do cabeçalho X-Ajuste (+ X-Falta-Mm) -> texto do indicador.
  function textoAjuste(valor, faltaMm) {
    if (valor === 'limite') {
      const f = faltaTexto(faltaMm);
      return { texto: f ? `passou do limite (faltam ${f})` : 'passou do limite', classe: 'limite', limite: true };
    }
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
      if (/cortado/i.test(msg)) {
        const c = { tipo: 'cortado', mensagem: msg };
        if (corpo.faltaMm !== undefined) c.faltaMm = corpo.faltaMm;
        return c;
      }
      return { tipo: 'conflito', mensagem: msg || 'A edição foi alterada por outra pessoa. Recarregue.' };
    }
    if (status === 400) return { tipo: 'validacao', mensagem: msg || 'Dados inválidos.' };
    if (status === 503) return { tipo: 'indisponivel', mensagem: MSG_503 };
    return { tipo: 'outro', mensagem: msg || `Erro inesperado (${status}).` };
  }

  // Token de idempotência de UMA tentativa de salvamento (UUID; senão 32 hex aleatórios).
  function novoToken(cripto = typeof crypto !== 'undefined' ? crypto : null) {
    if (cripto && typeof cripto.randomUUID === 'function') return cripto.randomUUID();
    const bytes = new Uint8Array(16);
    if (cripto && typeof cripto.getRandomValues === 'function') cripto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Falha de rede (sem status) ou 5xx: o servidor pode ter gravado mesmo sem a resposta chegar.
  const envioIncerto = (status) => status == null || status === 0 || status >= 500;

  // Se há um envio incerto pendente, ele é repetido com o MESMO payload e token; senão, tentativa nova.
  function planejarEnvio(incerto, gerarToken) {
    if (incerto) return { token: incerto.token, payload: incerto.payload, reenvio: true };
    return { token: gerarToken(), payload: null, reenvio: false };
  }

  const precisaConfirmarCorte = (tipo, ajuste) => ajuste === 'limite' && (tipo === 'pdf' || tipo === 'png-email');

  function nomeArquivo(contentDisposition, padrao) {
    const m = /filename="?([^";]+)"?/i.exec(contentDisposition || '');
    return m ? m[1] : padrao;
  }


  const ROTULOS_CAMPO = { etiqueta: 'Etiqueta', titulo: 'Título', texto: 'Texto', chamada: 'Linha de chamada' };
  const listaCampos = (campos) => campos.map((c) => ROTULOS_CAMPO[c] || c).join(', ');

  // Troca o tipo de um bloco preservando os campos de mesmo nome. Tipo novo desconhecido lança RangeError.
  // descartados: campos presentes em `dados`, ausentes no tipo novo e com valor não vazio (após trim);
  // faltando: campos do tipo novo que ficam vazios (após trim).
  function trocarTipo(dados, tipoNovo) {
    if (!Object.prototype.hasOwnProperty.call(CAMPOS, tipoNovo)) throw new RangeError('Tipo de bloco desconhecido: ' + tipoNovo);
    const origem = dados || {};
    const novos = CAMPOS[tipoNovo];
    const texto = (v) => (v == null ? '' : String(v));
    const out = {};
    novos.forEach((c) => { out[c] = texto(origem[c]); });
    const descartados = Object.keys(origem).filter((c) => !novos.includes(c) && texto(origem[c]).trim() !== '');
    const faltando = novos.filter((c) => out[c].trim() === '');
    return { dados: out, descartados, faltando };
  }

  // Link público: endereço absoluto = origem + base (prefixo de publicação) + /p/<token>.
  function urlPublica(origem, base, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(token)) throw new TypeError('Token inválido');
    const b = String.fromCharCode(47); // evita literal "/..." (a guarda de caminhos só aceita Api.url para isso)
    return String(origem).replace(/\/+$/, '') + String(base || '') + b + 'p' + b + token;
  }

  // Texto de estado da faixa "Link público" ('' quando a edição nunca foi publicada).
  function rotuloEstadoLink(status, temToken) {
    if (!temToken) return '';
    return status === 'publicada'
      ? 'Link público: mostra a edição publicada. Quem tiver o link pode ver e baixar o comunicado.'
      : 'Link público em revisão: o mesmo link mostra o aviso "em revisão" até a edição ser publicada de novo.';
  }

  return { urlPublica, rotuloEstadoLink, CAMPOS, ROTULOS_CAMPO, listaCampos, trocarTipo, LIMITE_CAMPO, MSG_503, mover, faltaTexto, textoCorte, novoToken, envioIncerto, planejarEnvio, textoAjuste, serializar, validarLocal, classificarErro, precisaConfirmarCorte, nomeArquivo };
});
