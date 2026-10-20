const TIPOS = ['destaque', 'card', 'dica', 'texto'];
const CAMPOS = {
  destaque: ['etiqueta', 'titulo', 'texto', 'chamada'],
  card: ['etiqueta', 'titulo', 'texto'],
  dica: ['titulo', 'texto'],
  texto: ['titulo', 'texto'],
};
const LIMITE = 2000;

function validateBlock(tipo, dados) {
  if (!TIPOS.includes(tipo)) return { ok: false, errors: [`tipo desconhecido: ${tipo}`], dados: {} };
  const entrada = dados && typeof dados === 'object' ? dados : {};
  const errors = [];
  const limpo = {};
  for (const campo of CAMPOS[tipo]) {
    const v = entrada[campo];
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) errors.push(`campo obrigatório: ${campo}`);
    else if (s.length > LIMITE) errors.push(`campo ${campo} excede ${LIMITE} caracteres`);
    limpo[campo] = s;
  }
  // Imagem opcional (id da tabela imagens): só inteiro positivo; qualquer outro valor é descartado.
  if (Number.isSafeInteger(entrada.imagem) && entrada.imagem > 0) limpo.imagem = entrada.imagem;
  return { ok: errors.length === 0, errors, dados: limpo };
}

module.exports = { TIPOS, validateBlock };
