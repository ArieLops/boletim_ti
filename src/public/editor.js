// Editor da edição: blocos, salvamento automático, pré-visualização ao vivo, downloads e publicação.
// A lógica pura (reordenar, serializar, validar, texto do indicador) está em editor-lib.js.
(function () {
  const L = window.EditorLib;
  const raiz = document.getElementById('editor');
  const ID = raiz.dataset.edicaoId;
  let versao = Number(raiz.dataset.versao);
  let travado = raiz.dataset.publicada === '1';

  const SALVAR_MS = 800; // pausa de digitação antes de salvar
  const INTERVALO_PREVIEW_MS = 600; // mínimo entre duas prévias (compartilham a fila do Chromium)
  const RETENTAR_MS = 8000;
  const A4_LARGURA = 794; // 210 mm em px CSS
  const A4_ALTURA = 1123; // 297 mm

  const $ = (id) => document.getElementById(id);
  const form = $('form-edicao');
  const lista = $('lista-blocos');
  const estado = $('estado-salvo');
  const indicador = $('indicador');
  const iframe = $('preview');
  const moldura = $('moldura');
  const erroBlocos = $('erro-blocos');
  const avisoGeral = $('aviso-geral');
  const avisoConflito = $('aviso-conflito');

  let sujo = false;
  let geracao = 0;
  let emCurso = null; // promessa do salvamento em andamento
  let conflito = false;
  let semAviso = false; // true ao recarregar de propósito (sem diálogo de "sair da página")
  let timerSalvar = null;
  let timerRetentar = null;
  let incerto = null; // envio cujo resultado é desconhecido: {token, payload, geracao, lis}
  let timerPreview = null;
  let corridaPreview = null;
  let pendentePreview = false;
  let inicioPreview = 0;
  let ajusteAtual = null;
  let faltaAtual = null;
  let ocupado = false;

  // ---------- anúncios e mensagens ----------
  const anuncio = document.createElement('div');
  anuncio.className = 'so-leitor';
  anuncio.setAttribute('aria-live', 'polite');
  document.body.appendChild(anuncio);
  const anunciar = (t) => { anuncio.textContent = t; };

  let timerAviso = null;
  function aviso(texto, tipo) {
    clearTimeout(timerAviso);
    if (!texto) { avisoGeral.hidden = true; return; }
    avisoGeral.textContent = texto;
    avisoGeral.className = 'aviso aviso-' + (tipo || 'info');
    avisoGeral.hidden = false;
    if (tipo === 'ok' || tipo === 'info') timerAviso = setTimeout(() => { avisoGeral.hidden = true; }, 9000);
  }

  function erroDosBlocos(textos) {
    if (!textos || !textos.length) { erroBlocos.hidden = true; erroBlocos.textContent = ''; return; }
    erroBlocos.textContent = textos.join(' ');
    erroBlocos.hidden = false;
  }

  function setEstado(chave, texto) {
    estado.dataset.estado = chave;
    estado.textContent = texto;
  }

  // ---------- leitura do formulário ----------
  function lerCampos() {
    return { mesAno: form.mesAno.value.trim(), titulo: form.titulo.value.trim(), subtitulo: form.subtitulo.value.trim() };
  }
  function itens() { return Array.from(lista.children); }
  function lerBloco(li) {
    const dados = {};
    li.querySelectorAll('input[name], textarea[name]').forEach((el) => { dados[el.name] = el.value; });
    return { id: li.dataset.id ? Number(li.dataset.id) : null, tipo: li.dataset.tipo, dados };
  }
  const montarPayload = () => L.serializar({ versao, campos: lerCampos(), blocos: itens().map(lerBloco) });

  // ---------- blocos ----------
  function atualizarPosicoes() {
    const lis = itens();
    lis.forEach((li, i) => {
      li.querySelector('.bloco-pos').textContent = (i + 1) + '.';
      li.querySelector('[data-acao="subir"]').disabled = travado || i === 0;
      li.querySelector('[data-acao="descer"]').disabled = travado || i === lis.length - 1;
    });
    $('blocos-vazios').hidden = lis.length > 0;
  }

  function adicionar(tipo) {
    const tpl = $('tpl-' + tipo);
    if (!tpl) return;
    const li = tpl.content.firstElementChild.cloneNode(true);
    lista.appendChild(li);
    atualizarPosicoes();
    const primeiro = li.querySelector('input, textarea');
    if (primeiro) primeiro.focus();
    anunciar('Bloco adicionado na posição ' + itens().length);
    marcarSujo();
  }

  function remover(li) {
    if (!window.confirm('Remover este bloco?')) return;
    const lis = itens();
    const vizinho = lis[lis.indexOf(li) + 1] || lis[lis.indexOf(li) - 1];
    li.remove();
    atualizarPosicoes();
    const alvo = vizinho ? vizinho.querySelector('[data-acao="remover"]') : document.querySelector('[data-adicionar]');
    if (alvo) alvo.focus();
    anunciar('Bloco removido');
    marcarSujo();
  }

  function mover(li, delta) {
    const lis = itens();
    const i = lis.indexOf(li);
    const nova = L.mover(lis, i, delta);
    if (nova[i] === li) return;
    nova.forEach((el) => lista.appendChild(el));
    atualizarPosicoes();
    const acao = delta < 0 ? 'subir' : 'descer';
    const botao = li.querySelector('[data-acao="' + acao + '"]');
    (botao && !botao.disabled ? botao : li.querySelector('[data-acao="' + (delta < 0 ? 'descer' : 'subir') + '"]')).focus();
    anunciar('Bloco movido para a posição ' + (itens().indexOf(li) + 1) + ' de ' + itens().length);
    marcarSujo();
  }

  lista.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-acao]');
    if (!botao || travado) return;
    const li = botao.closest('.bloco-item');
    if (botao.dataset.acao === 'remover') remover(li);
    else mover(li, botao.dataset.acao === 'subir' ? -1 : 1);
  });
  document.querySelectorAll('[data-adicionar]').forEach((b) => b.addEventListener('click', () => !travado && adicionar(b.dataset.adicionar)));

  // ---------- tipo do bloco ----------
  // Troca o tipo mantendo o data-id (o servidor atualiza a mesma linha). A regra de quais campos
  // sobram/são descartados/faltam é L.trocarTipo (pura, testada em tests/public/editor-tipos.test.js).
  function trocarTipoBloco(sel) {
    const li = sel.closest('.bloco-item');
    const antigo = li.dataset.tipo;
    const novo = sel.value;
    const tpl = $('tpl-' + novo);
    if (travado || novo === antigo) return;
    if (!tpl) { sel.value = antigo; return; }
    const r = L.trocarTipo(lerBloco(li).dados, novo);
    const rotulo = sel.options[sel.selectedIndex].textContent.trim();
    if (r.descartados.length && !window.confirm('Trocar para ' + rotulo + ' vai descartar: ' + L.listaCampos(r.descartados) + '. Continuar?')) {
      sel.value = antigo;
      return;
    }
    const nova = tpl.content.firstElementChild.cloneNode(true);
    if (li.dataset.id) nova.dataset.id = li.dataset.id;
    nova.querySelectorAll('input[name], textarea[name]').forEach((el) => { el.value = r.dados[el.name] || ''; });
    li.replaceWith(nova);
    atualizarPosicoes();
    nova.querySelector('[data-tipo-select]').focus();
    anunciar('Bloco ' + (itens().indexOf(nova) + 1) + ' agora é do tipo ' + rotulo);
    marcarSujo();
  }
  // O select dispara "input" além de "change"; só o "change" (já confirmado) deve marcar a edição como alterada.
  lista.addEventListener('input', (ev) => { if (ev.target.matches('[data-tipo-select]')) ev.stopPropagation(); }, true);
  lista.addEventListener('change', (ev) => { if (ev.target.matches('[data-tipo-select]')) trocarTipoBloco(ev.target); });

  // ---------- salvamento automático ----------
  function marcarSujo() {
    if (travado) return;
    sujo = true;
    geracao++;
    if (conflito) return;
    setEstado('pendente', 'Alterações não salvas');
    clearTimeout(timerSalvar);
    clearTimeout(timerRetentar);
    timerSalvar = setTimeout(salvarAgora, SALVAR_MS);
  }
  form.addEventListener('input', marcarSujo);
  lista.addEventListener('input', marcarSujo);

  // Resolve true quando tudo o que está na tela foi salvo (nada pendente, sem erro/conflito).
  function salvarAgora() {
    clearTimeout(timerSalvar);
    if (travado || conflito) return Promise.resolve(travado);
    if (emCurso) return emCurso.then(() => (sujo && !conflito ? salvarAgora() : !sujo && !conflito));
    if (!sujo) return Promise.resolve(true);
    emCurso = executarSalvar().finally(() => { emCurso = null; });
    return emCurso;
  }

  async function executarSalvar() {
    // Envio incerto anterior (rede/5xx): repete o MESMO payload com o MESMO token, para o servidor reconhecer
    // um save que já foi gravado; o que foi digitado depois segue no próximo ciclo (geracao diferente).
    const plano = L.planejarEnvio(incerto, L.novoToken);
    const payload = plano.reenvio ? plano.payload : montarPayload();
    if (!plano.reenvio) {
      const problemas = L.validarLocal(payload);
      if (problemas.length) {
        setEstado('invalido', 'Não salvo: faltam dados');
        erroDosBlocos(problemas);
        return false;
      }
    }
    erroDosBlocos([]);
    const geracaoEnviada = plano.reenvio ? incerto.geracao : geracao;
    const lisEnviados = plano.reenvio ? incerto.lis : itens();
    setEstado('salvando', 'Salvando…');
    let r;
    try {
      r = await Api.json('PUT', '/edicoes/' + ID, Object.assign({}, payload, { saveToken: plano.token }));
    } catch (e) {
      incerto = { token: plano.token, payload, geracao: geracaoEnviada, lis: lisEnviados };
      setEstado('erro', 'Erro ao salvar');
      aviso('Sem conexão com o servidor. Nova tentativa em instantes.', 'erro');
      timerRetentar = setTimeout(salvarAgora, RETENTAR_MS);
      return false;
    }
    if (L.envioIncerto(r.status)) incerto = { token: plano.token, payload, geracao: geracaoEnviada, lis: lisEnviados };
    else incerto = null;
    if (r.ok && r.corpo && Number.isInteger(r.corpo.versao)) {
      versao = r.corpo.versao;
      raiz.dataset.versao = String(versao);
      if (Array.isArray(r.corpo.blocos) && r.corpo.blocos.length === lisEnviados.length) {
        lisEnviados.forEach((li, i) => { if (!li.dataset.id) li.dataset.id = String(r.corpo.blocos[i].id); });
      }
      aviso('');
      if (geracaoEnviada === geracao) {
        sujo = false;
        setEstado('salvo', 'Salvo');
      } else {
        // houve edição durante o envio (ou após um envio incerto): salva de novo em seguida
        setEstado('pendente', 'Alterações não salvas');
        timerSalvar = setTimeout(salvarAgora, SALVAR_MS);
      }
      agendarPreview();
      return !sujo;
    }
    const c = L.classificarErro(r.status, r.corpo);
    if (c.tipo === 'conflito') {
      entrarEmConflito(c.mensagem);
    } else if (c.tipo === 'publicada') {
      travarInterface();
      entrarEmConflito('Esta edição foi publicada. Recarregue a página para ver o estado atual.');
    } else if (c.tipo === 'validacao') {
      setEstado('erro', 'Erro ao salvar');
      erroDosBlocos([c.mensagem]);
    } else if (c.tipo !== 'sessao') {
      setEstado('erro', 'Erro ao salvar');
      aviso(c.mensagem, 'erro');
      timerRetentar = setTimeout(salvarAgora, RETENTAR_MS);
    }
    return false;
  }

  function entrarEmConflito(mensagem) {
    conflito = true;
    clearTimeout(timerSalvar);
    clearTimeout(timerRetentar);
    setEstado('conflito', 'Conflito: não salvo');
    $('texto-conflito').textContent = mensagem.charAt(0).toUpperCase() + mensagem.slice(1);
    avisoConflito.hidden = false;
    avisoConflito.querySelector('button').focus();
  }
  $('btn-recarregar').addEventListener('click', () => { semAviso = true; window.location.reload(); });

  window.addEventListener('beforeunload', (ev) => {
    if (!semAviso && !travado && (sujo || emCurso)) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  // ---------- pré-visualização ----------
  function setIndicador(ajuste, faltaMm) {
    ajusteAtual = ajuste;
    faltaAtual = faltaMm;
    const t = L.textoAjuste(ajuste, faltaMm);
    indicador.textContent = t.texto;
    indicador.className = 'indicador indicador-' + t.classe;
  }

  const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

  async function buscarPreview() {
    inicioPreview = Date.now();
    try {
      // Accept inclui JSON para que sessão expirada devolva 401 (e não a página de login).
      const r = await fetch(Api.url('/edicoes/' + ID + '/preview'), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html, application/json;q=0.5' },
      });
      if (r.status === 401) return window.location.assign(Api.url('/login'));
      if (!r.ok) throw new Error('preview ' + r.status);
      const ajuste = r.headers.get('X-Ajuste');
      const faltaMm = r.headers.get('X-Falta-Mm');
      iframe.srcdoc = await r.text();
      setIndicador(ajuste, faltaMm);
    } catch (e) {
      setIndicador('indisponivel');
    }
  }

  // Uma busca por vez; pedidos feitos durante uma busca viram uma única nova busca depois dela.
  function atualizarPreview() {
    if (corridaPreview) { pendentePreview = true; return corridaPreview; }
    corridaPreview = (async () => {
      do {
        const espera = INTERVALO_PREVIEW_MS - (Date.now() - inicioPreview);
        if (espera > 0) await dormir(espera);
        pendentePreview = false;
        await buscarPreview();
      } while (pendentePreview);
    })().finally(() => { corridaPreview = null; moldura.classList.remove('atualizando'); });
    return corridaPreview;
  }

  function agendarPreview() {
    moldura.classList.add('atualizando');
    clearTimeout(timerPreview);
    timerPreview = setTimeout(atualizarPreview, 0);
  }

  // A moldura mostra a página A4 (794x1123 px) reduzida para caber na coluna.
  function ajustarEscala() {
    const k = Math.min(1, moldura.clientWidth / A4_LARGURA);
    iframe.style.transform = 'scale(' + k + ')';
    moldura.style.height = Math.round(A4_ALTURA * k) + 'px';
  }
  if (window.ResizeObserver) new ResizeObserver(ajustarEscala).observe(moldura);
  window.addEventListener('resize', ajustarEscala);
  ajustarEscala();

  // Salva o que estiver pendente e garante que o indicador reflita a versão salva.
  async function sincronizar() {
    if (travado) return true;
    const ok = await salvarAgora();
    if (!ok) {
      if (!conflito) aviso('Corrija os dados do formulário antes de continuar (veja os avisos acima).', 'erro');
      return false;
    }
    clearTimeout(timerPreview);
    await atualizarPreview();
    return true;
  }

  // ---------- downloads ----------
  function ocupar(sim, rotulo) {
    ocupado = sim;
    document.querySelectorAll('.barra-acoes button').forEach((b) => { b.disabled = sim || (travado && b.id === 'btn-publicar'); });
    raiz.setAttribute('aria-busy', sim ? 'true' : 'false');
    if (sim && rotulo) aviso(rotulo, 'info');
  }

  function salvarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function baixar(tipo) {
    if (ocupado) return;
    ocupar(true, 'Gerando arquivo…');
    try {
      if (!(await sincronizar())) return;
      let confirmar = false;
      if (!travado && L.precisaConfirmarCorte(tipo, ajusteAtual)) {
        if (!window.confirm(L.textoCorte(faltaAtual) + '. Baixar mesmo assim?')) return ocupar(false), aviso('');
        confirmar = true;
      }
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const r = await fetch(Api.url('/edicoes/' + ID + '/download/' + tipo + (confirmar ? '?confirmar=1' : '')), {
          credentials: 'same-origin',
          headers: Api.cabecalhos(),
        });
        if (r.status === 401) return window.location.assign(Api.url('/login'));
        if (r.ok) {
          const nome = L.nomeArquivo(r.headers.get('Content-Disposition'), 'comunicado-' + raiz.dataset.numero);
          salvarBlob(await r.blob(), nome);
          aviso(r.headers.get('X-Aviso')
            ? 'A imagem ficou muito alta; o WhatsApp pode comprimir.'
            : 'Arquivo gerado: ' + nome, r.headers.get('X-Aviso') ? 'info' : 'ok');
          return;
        }
        let corpo = null;
        try { corpo = await r.json(); } catch (e) { corpo = null; }
        const c = L.classificarErro(r.status, corpo);
        if (c.tipo === 'cortado' && !confirmar && window.confirm(L.textoCorte(c.faltaMm) + '. Baixar mesmo assim?')) { confirmar = true; continue; }
        return aviso(c.tipo === 'cortado' ? 'Download cancelado: o conteúdo seria cortado.' : c.mensagem, 'erro');
      }
    } catch (e) {
      aviso('Falha de conexão ao gerar o arquivo.', 'erro');
    } finally {
      ocupar(false);
    }
  }
  document.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => baixar(b.dataset.baixar)));

  // ---------- publicar / reabrir ----------
  function travarInterface() {
    travado = true;
    sujo = false;
    clearTimeout(timerSalvar);
    clearTimeout(timerRetentar);
    form.querySelectorAll('input, textarea').forEach((el) => { el.disabled = true; });
    lista.querySelectorAll('input, textarea, button, select').forEach((el) => { el.disabled = true; });
    document.querySelectorAll('[data-adicionar]').forEach((el) => { el.disabled = true; });
    $('btn-publicar').hidden = true;
    $('btn-reabrir').hidden = false;
    estado.hidden = true;
    const selo = $('selo-status');
    selo.textContent = 'Publicada';
    selo.className = 'selo selo-publicada';
    raiz.dataset.publicada = '1';
  }

  async function publicar() {
    if (ocupado || travado) return;
    ocupar(true, 'Preparando a publicação…');
    try {
      if (!(await sincronizar())) return;
      const limite = ajusteAtual === 'limite';
      const texto = limite
        ? L.textoCorte(faltaAtual) + ' na página A4. Publicar mesmo assim? A edição ficará travada.'
        : 'Publicar a edição ' + raiz.dataset.numero + '? Os arquivos serão gerados e a edição ficará travada.';
      if (!window.confirm(texto)) return ocupar(false), aviso('');
      aviso('Publicando: gerando PDF e imagens…', 'info');
      let confirmar = limite;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const r = await Api.json('POST', '/edicoes/' + ID + '/publicar', confirmar ? { confirmar: 1 } : {});
        if (r.ok) {
          travarInterface();
          mostrarLinkPublico(r.corpo && r.corpo.token, 'publicada');
          aviso('Publicada. Os arquivos foram gerados e guardados.', 'ok');
          return;
        }
        const c = L.classificarErro(r.status, r.corpo);
        if (c.tipo === 'cortado' && !confirmar && window.confirm(L.textoCorte(c.faltaMm) + '. Publicar mesmo assim?')) { confirmar = true; continue; }
        if (c.tipo === 'conflito' || c.tipo === 'publicada') return aviso(c.mensagem + ' Recarregue a página.', 'erro');
        return aviso(c.tipo === 'cortado' ? 'Publicação cancelada: o conteúdo seria cortado.' : c.mensagem, 'erro');
      }
    } catch (e) {
      aviso('Falha de conexão ao publicar.', 'erro');
    } finally {
      ocupar(false);
    }
  }

  async function reabrir() {
    if (ocupado) return;
    if (!window.confirm('Reabrir a edição? Os arquivos publicados serão descartados e regerados na próxima publicação.')) return;
    ocupar(true, 'Reabrindo…');
    try {
      const r = await Api.json('POST', '/edicoes/' + ID + '/reabrir', {});
      if (r.ok) { semAviso = true; return window.location.reload(); }
      aviso(L.classificarErro(r.status, r.corpo).mensagem, 'erro');
    } catch (e) {
      aviso('Falha de conexão ao reabrir.', 'erro');
    } finally {
      ocupar(false);
    }
  }
  $('btn-publicar').addEventListener('click', publicar);
  $('btn-reabrir').addEventListener('click', reabrir);

  // ---------- link público ----------
  function criarFaixaLink() {
    const faixa = document.createElement('section');
    faixa.id = 'link-publico';
    faixa.className = 'link-publico cartao';
    faixa.setAttribute('aria-labelledby', 'link-publico-titulo');
    const h = document.createElement('h2');
    h.id = 'link-publico-titulo';
    h.textContent = 'Link público';
    const estadoLink = document.createElement('p');
    estadoLink.id = 'link-publico-estado';
    estadoLink.className = 'suave';
    const linha = document.createElement('div');
    linha.className = 'link-publico-linha';
    const campo = document.createElement('input');
    campo.id = 'link-publico-url';
    campo.type = 'text';
    campo.readOnly = true;
    campo.setAttribute('aria-label', 'Endereço do link público');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.id = 'btn-copiar-link';
    botao.className = 'btn btn-claro';
    botao.textContent = 'Copiar link';
    linha.append(campo, botao);
    const msg = document.createElement('span');
    msg.id = 'link-publico-msg';
    msg.className = 'link-publico-msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    faixa.append(h, estadoLink, linha, msg);
    raiz.insertBefore(faixa, raiz.querySelector('.colunas'));
    return faixa;
  }

  // Mostra/atualiza a faixa: cria se ainda não existe (1ª publicação sem recarregar).
  function mostrarLinkPublico(token, status) {
    if (typeof token !== 'string') return;
    let url;
    try { url = L.urlPublica(window.location.origin, Api.base, token); } catch (e) { return; }
    const faixa = $('link-publico') || criarFaixaLink();
    faixa.dataset.token = token;
    $('link-publico-url').value = url;
    $('link-publico-estado').textContent = L.rotuloEstadoLink(status, true);
  }

  async function copiarLink() {
    const campo = $('link-publico-url');
    const msg = $('link-publico-msg');
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(campo.value); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      campo.focus();
      campo.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    }
    msg.textContent = '';
    // Reatribui no próximo ciclo para a região aria-live anunciar de novo.
    setTimeout(() => { msg.textContent = ok ? 'Link copiado' : 'Não foi possível copiar: selecione o campo e copie manualmente.'; }, 30);
  }

  // Delegação: a faixa pode ser criada depois (1ª publicação).
  raiz.addEventListener('click', (e) => {
    if (e.target.closest('#btn-copiar-link')) copiarLink();
  });
  (function iniciarLinkPublico() {
    const faixa = $('link-publico');
    if (faixa) mostrarLinkPublico(faixa.dataset.token, travado ? 'publicada' : 'rascunho');
  })();

  // ---------- início ----------
  atualizarPosicoes();
  if (!travado) setEstado('salvo', 'Salvo');
  atualizarPreview();
})();
