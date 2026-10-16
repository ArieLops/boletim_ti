// Cliente mínimo da API JSON: envia Accept: application/json e o token CSRF em todas as chamadas.
// Sessão expirada (401) leva ao login.
(function () {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const csrf = meta ? meta.content : '';

  function cabecalhos(extra) {
    return Object.assign({ Accept: 'application/json', 'X-CSRF-Token': csrf }, extra || {});
  }

  // Retorna { status, ok, corpo } (corpo = JSON ou null). Lança só em falha de rede.
  async function json(metodo, url, corpo, opcoes) {
    const init = Object.assign({ method: metodo, credentials: 'same-origin', headers: cabecalhos() }, opcoes || {});
    if (corpo !== undefined) {
      init.headers = cabecalhos({ 'Content-Type': 'application/json' });
      init.body = JSON.stringify(corpo);
    }
    const r = await fetch(url, init);
    let dados = null;
    try {
      dados = await r.clone().json();
    } catch (e) {
      dados = null;
    }
    if (r.status === 401) window.location.assign('/login');
    return { status: r.status, ok: r.ok, corpo: dados, resposta: r };
  }

  window.Api = { csrf: csrf, cabecalhos: cabecalhos, json: json };
})();
