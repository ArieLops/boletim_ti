// Tela de configurações (administrador): salva /api/configuracoes e envia o logo (PUT binário).
(function () {
  const form = document.getElementById('form-config');
  const msg = document.getElementById('msg-config');
  const formLogo = document.getElementById('form-logo');
  const msgLogo = document.getElementById('msg-logo');
  const img = document.getElementById('logo-atual');
  const semLogo = document.getElementById('sem-logo');

  function mostrar(el, texto, erro) {
    el.textContent = texto;
    el.className = 'aviso ' + (erro ? 'aviso-erro' : 'aviso-ok');
    el.hidden = false;
  }

  function mostrarLogo() {
    img.hidden = false;
    semLogo.hidden = true;
    img.src = '/api/configuracoes/logo?t=' + Date.now();
  }
  img.addEventListener('error', function () {
    img.hidden = true;
    semLogo.hidden = false;
  });

  document.getElementById('cores-padrao').addEventListener('click', function () {
    form.querySelectorAll('[data-padrao]').forEach(function (el) {
      el.value = el.dataset.padrao;
    });
  });

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    msg.hidden = true;
    const piso = Number(form.pisoReducao.value);
    if (!Number.isFinite(piso) || piso < 50 || piso > 100) return mostrar(msg, 'O piso de redução deve estar entre 50 e 100.', true);
    // Só cores diferentes do padrão são gravadas (o servidor substitui o conjunto inteiro).
    const cores = {};
    form.querySelectorAll('[data-padrao]').forEach(function (el) {
      if (el.value.trim().toLowerCase() !== el.dataset.padrao.toLowerCase()) cores[el.name] = el.value.trim();
    });
    const corpo = {
      emailTi: form.emailTi.value.trim(),
      rodape: form.rodape.value.trim(),
      subtitulo: form.subtitulo.value.trim(),
      pisoReducao: piso / 100,
      cores: cores,
    };
    try {
      const r = await Api.json('POST', '/api/configuracoes', corpo);
      if (r.ok) mostrar(msg, 'Configurações salvas.', false);
      else mostrar(msg, (r.corpo && r.corpo.erro) || 'Não foi possível salvar.', true);
    } catch (e) {
      mostrar(msg, 'Falha de conexão. Tente novamente.', true);
    }
  });

  formLogo.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    msgLogo.hidden = true;
    const arquivo = formLogo.logo.files[0];
    if (!arquivo) return mostrar(msgLogo, 'Escolha um arquivo PNG ou JPEG.', true);
    if (arquivo.type !== 'image/png' && arquivo.type !== 'image/jpeg') return mostrar(msgLogo, 'O logo deve ser PNG ou JPEG.', true);
    if (arquivo.size > 2 * 1024 * 1024) return mostrar(msgLogo, 'O arquivo excede 2 MB.', true);
    try {
      const r = await fetch('/api/configuracoes/logo', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: Api.cabecalhos({ 'Content-Type': arquivo.type }),
        body: arquivo,
      });
      if (r.status === 401) return window.location.assign('/login');
      if (r.ok) {
        mostrar(msgLogo, 'Logo atualizado.', false);
        mostrarLogo();
        formLogo.reset();
      } else {
        let corpo = null;
        try { corpo = await r.json(); } catch (e) { corpo = null; }
        mostrar(msgLogo, (corpo && corpo.erro) || 'Não foi possível enviar o logo.', true);
      }
    } catch (e) {
      mostrar(msgLogo, 'Falha de conexão. Tente novamente.', true);
    }
  });
})();
