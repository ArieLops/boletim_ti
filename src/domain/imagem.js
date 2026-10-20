const MAX_BYTES = 2 * 1024 * 1024;
const MAX_BLOCOS_COM_IMAGEM = 30; // blocos que podem ter imagem ao mesmo tempo
const MAX_POR_EDICAO = 60; // imagens enviadas/armazenadas (inclui as órfãs que esperam 1 hora para a limpeza)

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

// O tipo vem do CONTEÚDO (assinatura), nunca do cabeçalho ou do nome do arquivo. SVG, GIF e o resto => null.
function detectarMime(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { detectarMime, MAX_BYTES, MAX_POR_EDICAO, MAX_BLOCOS_COM_IMAGEM };
