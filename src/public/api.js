// Cliente mínimo da API JSON: envia Accept: application/json e o token CSRF em todas as chamadas.
// Sessão expirada (401) leva ao login. Todas as URLs são prefixadas com o BASE_PATH lido de
// <meta name="base-path"> (vazio na raiz); quem chama passa caminhos da APLICAÇÃO ("/edicoes/1").

// Pura (testável em Node): prefixa `path` com `base`. `path` deve começar com "/" e não com "//" nem "/\\".
// Query e hash são preservados. Caminho que já começa com a base não é prefixado de novo.
function urlComBase(base, path) {
  if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\') {
    throw new Error('caminho interno inválido: ' + JSON.stringify(path) + ' (deve começar com "/" e não com "//" nem "/\\")');
  }
  if (!base) return path;
  const depois = path.charAt(base.length);
  if (path.indexOf(base) === 0 && (path.length === base.length || depois === '/' || depois === '?' || depois === '#')) return path;
  return base + path;
}

(function () {
  if (typeof document === 'undefined') return; // carregado em Node (testes): só exporta urlComBase
  const metaCsrf = document.querySelector('meta[name="csrf-token"]');
  const csrf = metaCsrf ? metaCsrf.content : '';
  const metaBase = document.querySelector('meta[name="base-path"]');
  const base = metaBase ? metaBase.content : '';

  function url(path) {
    return urlComBase(base, path);
  }

  function cabecalhos(extra) {
    return Object.assign({ Accept: 'application/json', 'X-CSRF-Token': csrf }, extra || {});
  }

  // Retorna { status, ok, corpo } (corpo = JSON ou null). Lança só em falha de rede.
  async function json(metodo, caminho, corpo, opcoes) {
    const init = Object.assign({ method: metodo, credentials: 'same-origin', headers: cabecalhos() }, opcoes || {});
    if (corpo !== undefined) {
      init.headers = cabecalhos({ 'Content-Type': 'application/json' });
      init.body = JSON.stringify(corpo);
    }
    const r = await fetch(url(caminho), init);
    let dados = null;
    try {
      dados = await r.clone().json();
    } catch (e) {
      dados = null;
    }
    if (r.status === 401) window.location.assign(url('/login'));
    return { status: r.status, ok: r.ok, corpo: dados, resposta: r };
  }

  window.Api = { csrf: csrf, base: base, url: url, urlComBase: urlComBase, cabecalhos: cabecalhos, json: json };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { urlComBase: urlComBase };
