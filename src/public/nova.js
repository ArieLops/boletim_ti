// Tela "Nova edição": cria via POST /edicoes (número sugerido pelo servidor) e abre o editor.
(function () {
  const form = document.getElementById('form-nova');
  const erro = document.getElementById('erro-nova');
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    erro.hidden = true;
    const botao = form.querySelector('button[type="submit"]');
    const corpo = { mesAno: form.mesAno.value.trim(), titulo: form.titulo.value.trim() };
    if (form.subtitulo.value.trim()) corpo.subtitulo = form.subtitulo.value.trim();
    botao.disabled = true;
    try {
      const r = await Api.json('POST', '/edicoes', corpo);
      if (r.ok && r.corpo && r.corpo.id) return window.location.assign('/edicoes/' + r.corpo.id);
      erro.textContent = (r.corpo && r.corpo.erro) || 'Não foi possível criar a edição.';
    } catch (e) {
      erro.textContent = 'Falha de conexão. Tente novamente.';
    }
    erro.hidden = false;
    botao.disabled = false;
  });
})();
