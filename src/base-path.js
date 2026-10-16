// Prefixo de publicação (ex.: "/boletim_ti" atrás de um proxy reverso que mantém o prefixo).
// Modo raiz = string vazia. Esta é a única fonte de verdade para montar URLs internas.
const SEGMENTOS = /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

function normalizeBasePath(raw) {
  if (raw === undefined || raw === null) return '';
  const s = String(raw).trim();
  if (s === '' || s === '/') return '';
  const semFinais = s.replace(/\/+$/, '');
  const ok = SEGMENTOS.test(semFinais) && !semFinais.split('/').some((seg) => seg === '.' || seg === '..');
  if (!ok) {
    throw new Error(
      `BASE_PATH inválido (${JSON.stringify(s)}): use algo como "/boletim_ti" (segmentos com letras, dígitos, ".", "_", "~" ou "-"; sem "//", "..", "?", "#", "%" ou endereço completo).`
    );
  }
  return semFinais;
}

// u(path): path interno da aplicação ("/login") -> URL pública ("/boletim_ti/login").
function makeUrl(base) {
  return function u(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new Error(`caminho interno inválido: ${JSON.stringify(path)} (deve começar com "/" e não com "//")`);
    }
    return base + path;
  };
}

// Remove o prefixo de uma URL de requisição (originalUrl); URL fora do prefixo é devolvida como veio.
function relativePath(base, originalUrl) {
  if (!base || typeof originalUrl !== 'string') return originalUrl;
  if (originalUrl === base) return '/';
  if (originalUrl.startsWith(base + '/')) return originalUrl.slice(base.length);
  if (originalUrl.startsWith(base + '?')) return '/' + originalUrl.slice(base.length);
  return originalUrl;
}

module.exports = { normalizeBasePath, makeUrl, relativePath };
