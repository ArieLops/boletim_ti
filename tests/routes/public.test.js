process.env.BCRYPT_COST ??= '4';
process.env.BOLETIM_TEST_DB = 'boletim_test_public';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, blocoCard, PNG_SIG } = require('../helpers/routes');
const { createApp } = require('../../src/app');
const { createThrottle } = require('../../src/auth/throttle');

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const HOSTIL = '<script>alert(1)</script><img src=x onerror=1>&';
const binario = (req) => req.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

let ctx, ex, edu, app, appPequeno, tokenA, idA, tokenRev, idRev, tokenXss;

const publicar = async (titulo, blocos, extra = {}) => {
  const c = await edu.post('/edicoes', { mesAno: '2026-10', titulo, ...extra });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await edu.put(`/edicoes/${c.body.id}`, { versao: 1, blocos });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const p = await edu.post(`/edicoes/${c.body.id}/publicar`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { id: c.body.id, token: p.body.token };
};
const nSessoes = async () => Number((await ctx.pool.query('SELECT COUNT(*) AS n FROM sessions'))[0][0].n);

before(async () => {
  ex = fakeExporter();
  ctx = await setup({ exporter: ex });
  // Throttle folgado no app principal (os testes compartilham o IP); o pequeno é injetado onde se testa o 429.
  app = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, publicThrottle: createThrottle({ max: 100000 }) });
  appPequeno = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1, publicThrottle: createThrottle({ max: 3, janelaMs: 600000 }) });
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
  ({ id: idA, token: tokenA } = await publicar('Comunicado público', [blocoCard(1), blocoCard(2)], { subtitulo: 'Subtítulo público' }));
  ({ id: idRev, token: tokenRev } = await publicar('Rascunho secreto', [{ tipo: 'texto', dados: { titulo: 'Texto sigiloso', texto: 'Conteúdo sigiloso' } }], { subtitulo: 'Sub sigiloso' }));
  const r = await edu.post(`/edicoes/${idRev}/reabrir`);
  assert.equal(r.status, 200);
  ({ token: tokenXss } = await publicar(HOSTIL, [
    { tipo: 'destaque', dados: { etiqueta: HOSTIL, titulo: HOSTIL, texto: HOSTIL, chamada: HOSTIL } },
    { tipo: 'card', dados: { etiqueta: HOSTIL, titulo: HOSTIL, texto: HOSTIL } },
    { tipo: 'dica', dados: { titulo: HOSTIL, texto: HOSTIL } },
    { tipo: 'texto', dados: { titulo: HOSTIL, texto: HOSTIL } },
  ], { subtitulo: HOSTIL }));
});
after(async () => {
  await app.locals.close();
  await appPequeno.locals.close();
  await ctx.close();
});

function conferirCabecalhos(res, rotulo) {
  assert.equal(res.headers['cache-control'], 'no-store', rotulo);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', rotulo);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', rotulo);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', rotulo);
  assert.equal(res.headers['content-security-policy'], CSP, rotulo);
  assert.equal(res.headers['set-cookie'], undefined, `${rotulo}: Set-Cookie`);
}

test('edição publicada: 200 HTML com título, blocos e os três links de download', async () => {
  const antes = await nSessoes();
  const r = await request(app).get(`/p/${tokenA}`);
  assert.equal(r.status, 200);
  assert.match(r.type, /html/);
  conferirCabecalhos(r, 'página');
  assert.match(r.text, /<title>Comunicado público<\/title>/);
  assert.ok(r.text.includes('Subtítulo público') && r.text.includes('Título 1') && r.text.includes('Texto 2'));
  for (const t of ['pdf', 'png-email', 'png-whatsapp']) assert.ok(r.text.includes(`href="/p/${tokenA}/baixar/${t}"`), t);
  assert.ok(r.text.includes('Baixar PDF (A4)') && r.text.includes('Baixar imagem para e-mail') && r.text.includes('Baixar imagem para WhatsApp'));
  assert.ok(!/<script/i.test(r.text));
  assert.equal(await nSessoes(), antes);
});

test('a página não expõe dados do editor (id, autor, CSRF, histórico)', async () => {
  const r = await request(app).get(`/p/${tokenA}`);
  const texto = r.text.replace(/data:[^"')]*/g, "DATA"); // fontes/logo em base64 não contam
  assert.ok(!/csrf/i.test(texto));
  assert.ok(!texto.includes('Edu'));
  assert.ok(!/histórico|historico|\/edicoes|\/login/i.test(texto));
  assert.ok(!new RegExp(`(data-id|edicao[_-]?id|"id")\\s*[=:]\\s*"?${idA}\\b`).test(texto));
});

test('nenhum Set-Cookie e nenhuma sessão nova após várias requisições de todos os tipos', async () => {
  const antes = await nSessoes();
  const urls = [`/p/${tokenA}`, `/p/${tokenRev}`, '/p/naoexiste', `/p/${'x'.repeat(22)}`, `/p/${tokenA}/baixar/pdf`, `/p/${tokenA}/baixar/zip`, `/p/${tokenRev}/baixar/pdf`];
  for (let i = 0; i < 3; i++) {
    for (const u of urls) {
      const r = await request(app).get(u);
      assert.equal(r.headers['set-cookie'], undefined, u);
    }
  }
  assert.equal(await nSessoes(), antes);
});

test('reaberta: 200 "em revisão" sem nada do rascunho e sem links', async () => {
  const r = await request(app).get(`/p/${tokenRev}`);
  assert.equal(r.status, 200);
  conferirCabecalhos(r, 'revisão');
  assert.ok(r.text.includes('Comunicado em revisão') && r.text.includes('Este comunicado está em revisão. Volte em instantes.'));
  for (const t of ['Rascunho secreto', 'Sub sigiloso', 'sigiloso', 'Texto sigiloso']) assert.ok(!r.text.includes(t), t);
  assert.ok(!r.text.includes('/baixar/') && !r.text.includes('href='));
  assert.match(r.text, /<meta name="robots" content="noindex">/);
  assert.match(r.text, /<html lang="pt-BR">/);
});

test('reabrir e publicar de novo mantém o mesmo link', async () => {
  const novo = await publicar('Ciclo', [blocoCard(1)]);
  assert.equal((await request(app).get(`/p/${novo.token}`)).status, 200);
  await edu.post(`/edicoes/${novo.id}/reabrir`);
  const rev = await request(app).get(`/p/${novo.token}`);
  assert.ok(rev.text.includes('em revisão') && !rev.text.includes('Ciclo'));
  const p = await edu.post(`/edicoes/${novo.id}/publicar`);
  assert.equal(p.body.token, novo.token);
  const r = await request(app).get(`/p/${novo.token}`);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('Ciclo'));
});

test('404: formato inválido e token desconhecido têm corpo e cabeçalhos idênticos', async () => {
  const desconhecido = await request(app).get(`/p/${'A'.repeat(22)}`);
  const curto = await request(app).get('/p/abc');
  const lixo = await request(app).get('/p/%3Cb%3E%24%25');
  const longo = await request(app).get(`/p/${'a'.repeat(200)}`);
  const decod = await request(app).get('/p/%E0%A4%A');
  for (const r of [desconhecido, curto, lixo, longo, decod]) {
    assert.equal(r.status, 404);
    conferirCabecalhos(r, '404');
    assert.equal(r.text, desconhecido.text);
    assert.equal(r.headers['content-type'], desconhecido.headers['content-type']);
    assert.equal(r.headers['content-length'], desconhecido.headers['content-length']);
  }
  assert.ok(desconhecido.text.includes('Link não encontrado') && desconhecido.text.includes('Confira se o endereço foi copiado por inteiro.'));
  assert.ok(!desconhecido.text.includes('href='));
  assert.match(desconhecido.text, /<meta name="robots" content="noindex">/);
});

test('token que difere só na caixa das letras → 404 (e o real continua 200)', async () => {
  const outro = [...tokenA].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
  assert.notEqual(outro, tokenA);
  assert.equal((await request(app).get(`/p/${outro}`)).status, 404);
  assert.equal((await request(app).get(`/p/${tokenA}`)).status, 200);
  assert.equal((await request(app).get(`/p/${outro}/baixar/pdf`)).status, 404);
});

test('downloads devolvem os bytes publicados com os cabeçalhos dos downloads autenticados', async () => {
  const casos = [['pdf', 'application/pdf', 'comunicado-001.pdf', 'pdf'], ['png-email', 'image/png', 'comunicado-001-email.png', 'png_email'], ['png-whatsapp', 'image/png', 'comunicado-001-whatsapp.png', 'png_whatsapp']];
  const antes = Number((await ctx.pool.query("SELECT COUNT(*) AS n FROM historico WHERE acao = 'baixou'"))[0][0].n);
  for (const [tipo, mime, nome, db] of casos) {
    const r = await binario(request(app).get(`/p/${tokenA}/baixar/${tipo}`));
    assert.equal(r.status, 200, tipo);
    assert.equal(r.headers['content-type'], mime);
    assert.equal(r.headers['content-disposition'], `attachment; filename="${nome}"`);
    conferirCabecalhos(r, tipo);
    const [rows] = await ctx.pool.query('SELECT conteudo FROM arquivos_publicados WHERE edicao_id = ? AND tipo = ?', [idA, db]);
    assert.ok(Buffer.from(rows[0].conteudo).equals(r.body), tipo);
    if (mime === 'image/png') assert.ok(r.body.subarray(0, 8).equals(PNG_SIG));
    else assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  }
  const depois = Number((await ctx.pool.query("SELECT COUNT(*) AS n FROM historico WHERE acao = 'baixou'"))[0][0].n);
  assert.equal(depois, antes, 'downloads públicos não gravam histórico');
});

test('downloads: edição reaberta, tipo desconhecido e herança de Object → mesmo 404 genérico', async () => {
  const base = await request(app).get('/p/abc/baixar/pdf');
  assert.equal(base.status, 404);
  for (const u of [`/p/${tokenRev}/baixar/pdf`, `/p/${tokenA}/baixar/zip`, `/p/${tokenA}/baixar/constructor`, `/p/${tokenA}/baixar/__proto__`, `/p/${tokenA}/baixar/PDF`]) {
    const r = await request(app).get(u);
    assert.equal(r.status, 404, u);
    assert.equal(r.text, base.text, u);
    conferirCabecalhos(r, u);
  }
});

test('arquivo ausente de uma edição publicada → 404', async () => {
  const x = await publicar('Sem arquivo', [blocoCard(1)]);
  await ctx.pool.query("DELETE FROM arquivos_publicados WHERE edicao_id = ? AND tipo = 'pdf'", [x.id]);
  assert.equal((await request(app).get(`/p/${x.token}/baixar/pdf`)).status, 404);
  assert.equal((await request(app).get(`/p/${x.token}/baixar/png-email`)).status, 200);
});

test('HTML hostil em título, subtítulo e todos os campos dos blocos sai escapado', async () => {
  const r = await request(app).get(`/p/${tokenXss}`);
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.ok(!r.text.includes('<img src=x'));
  assert.ok(r.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=1&gt;&amp;'));
  assert.match(r.text, /<title>&lt;script&gt;/);
});

test('Accept: application/json ainda recebe a página HTML', async () => {
  const r = await request(app).get(`/p/${tokenA}`).set('Accept', 'application/json');
  assert.equal(r.status, 200);
  assert.match(r.type, /html/);
  const n = await request(app).get('/p/abc').set('Accept', 'application/json');
  assert.equal(n.status, 404);
  assert.match(n.type, /html/);
});

test('rotas autenticadas continuam exigindo login e a 404 geral permanece', async () => {
  const a = await request(app).get('/edicoes/1');
  assert.ok([302, 401].includes(a.status), String(a.status));
  const b = await request(app).get('/edicoes').set('Accept', 'application/json');
  assert.ok([302, 401].includes(b.status));
  const c = await request(app).get('/qualquer-coisa');
  assert.equal(c.status, 404);
  assert.equal(c.text, 'Não encontrado');
  const d = await request(app).get(`/p/${tokenA}/outro`);
  assert.equal(d.status, 404);
  assert.equal(d.text, 'Não encontrado');
  const e = await request(app).post(`/p/${tokenA}`).send({});
  assert.ok([401, 403, 404].includes(e.status), String(e.status));
});

test('maiúsculas no caminho não casam com a rota pública', async () => {
  const r = await request(app).get(`/P/${tokenA}`);
  assert.equal(r.status, 404);
  assert.equal(r.text, 'Não encontrado');
});

test('throttle: após max falhas do mesmo IP responde 429 sem consultar o banco; outro IP segue 200', async () => {
  const ipA = '203.0.113.7';
  const get = (u, ip) => request(appPequeno).get(u).set('X-Forwarded-For', ip);
  for (let i = 0; i < 3; i++) assert.equal((await get('/p/naoexiste', ipA)).status, 404, `falha ${i + 1}`);
  const original = ctx.pool.query;
  let chamadas = 0;
  ctx.pool.query = function (...a) { chamadas++; return original.apply(this, a); };
  try {
    for (const u of [`/p/${tokenA}`, '/p/naoexiste', `/p/${tokenA}/baixar/pdf`, `/p/${'z'.repeat(22)}`]) {
      const r = await get(u, ipA);
      assert.equal(r.status, 429, u);
      assert.equal(r.type, 'text/plain');
      assert.equal(r.text, 'Muitas tentativas. Aguarde alguns minutos.');
      conferirCabecalhos(r, '429');
    }
    assert.equal(chamadas, 0, 'o 429 não toca o banco');
  } finally {
    ctx.pool.query = original;
  }
  assert.equal((await get(`/p/${tokenA}`, '203.0.113.8')).status, 200);
});

test('throttle: requisição válida não conta como falha nem limpa as falhas', async () => {
  const ip = '198.51.100.9';
  const get = (u) => request(appPequeno).get(u).set('X-Forwarded-For', ip);
  for (let i = 0; i < 10; i++) assert.equal((await get(`/p/${tokenA}`)).status, 200);
  await get('/p/naoexiste');
  await get('/p/abc');
  assert.equal((await get(`/p/${tokenA}`)).status, 200, 'duas falhas, ainda abaixo do limite');
  await get('/p/naoexiste'); // 3a falha: a válida no meio não limpou as anteriores
  assert.equal((await get(`/p/${tokenA}`)).status, 429);
});

test('o throttle padrão é de 30 falhas em 10 minutos e fica em app.locals.publicThrottle', async () => {
  const padrao = createApp({ pool: ctx.pool, exporter: ex, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1 });
  try {
    const t = padrao.locals.publicThrottle;
    for (let i = 0; i < 29; i++) t.registrarFalha('k');
    assert.equal(t.bloqueado('k'), false);
    t.registrarFalha('k');
    assert.equal(t.bloqueado('k'), true);
  } finally {
    await padrao.locals.close();
  }
});
