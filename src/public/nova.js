// Tela "Nova edição": cria via POST /edicoes (número editável, sugerido pelo servidor) e abre o editor.
(function () {
  const form = document.getElementById('form-nova');
  const erro = document.getElementById('erro-nova');
  const erroNumero = document.getElementById('erro-numero');
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    erro.hidden = true;
    erroNumero.hidden = true;
    const botao = form.querySelector('button[type="submit"]');
    const numero = Number(form.numero.value);
    if (!Number.isInteger(numero) || numero < 1) {
      erroNumero.textContent = 'Informe um número inteiro positivo.';
      erroNumero.hidden = false;
      form.numero.focus();
      return;
    }
    const corpo = { numero, mesAno: form.mesAno.value.trim(), titulo: form.titulo.value.trim() };
    if (form.subtitulo.value.trim()) corpo.subtitulo = form.subtitulo.value.trim();
    botao.disabled = true;
    try {
      const r = await Api.json('POST', '/edicoes', corpo);
      if (r.ok && r.corpo && r.corpo.id) return window.location.assign('/edicoes/' + r.corpo.id);
      const msg = (r.corpo && r.corpo.erro) || 'Não foi possível criar a edição.';
      if (r.status === 409 && /número/.test(msg)) {
        erroNumero.textContent = msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
        erroNumero.hidden = false;
        form.numero.focus();
        botao.disabled = false;
        return;
      }
      erro.textContent = msg;
    } catch (e) {
      erro.textContent = 'Falha de conexão. Tente novamente.';
    }
    erro.hidden = false;
    botao.disabled = false;
  });
})();
