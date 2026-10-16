process.env.BOLETIM_TEST_DB = 'boletim_test_rt_settings';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, entrar, fakeExporter, PNG_SIG } = require('../helpers/routes');

let ctx, admin, edu;
before(async () => {
  ctx = await setup({ exporter: fakeExporter() });
  admin = await entrar(ctx.app, 'admin', 'senha-admin-123');
  edu = await entrar(ctx.app, 'edu', 'senha-edu-123');
});
after(() => ctx.close());

const png = Buffer.concat([PNG_SIG, Buffer.alloc(64, 7)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
const enviarLogo = (a, corpo, tipo) => a.agent.put('/api/configuracoes/logo').set('X-CSRF-Token', a.csrf).set('Content-Type', tipo).send(corpo);

test('configurações: editor leva 403 em tudo; anônimo é redirecionado', async () => {
  assert.equal((await edu.get('/api/configuracoes')).status, 403);
  assert.equal((await edu.post('/api/configuracoes', { rodape: 'x' })).status, 403);
  assert.equal((await enviarLogo(edu, png, 'image/png')).status, 403);
  assert.equal((await edu.get('/api/configuracoes/logo')).status, 403);
  assert.equal((await request(ctx.app).get('/api/configuracoes')).status, 302);
});

test('GET devolve os padrões; POST atualiza e persiste', async () => {
  const g = await admin.get('/api/configuracoes');
  assert.equal(g.status, 200);
  assert.equal(g.body.emailTi, 'informatica@senar-rs.com.br');
  assert.equal(g.body.pisoReducao, 0.75);
  const p = await admin.post('/api/configuracoes', {
    emailTi: 'ti@senar-rs.com.br', rodape: 'Rodapé novo', subtitulo: 'Sub novo', pisoReducao: 0.6,
    cores: { '--teal': '#0a7f6f', '--fundo': 'rgb(1, 2, 3)' },
  });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const g2 = await admin.get('/api/configuracoes');
  assert.equal(g2.body.emailTi, 'ti@senar-rs.com.br');
  assert.equal(g2.body.rodape, 'Rodapé novo');
  assert.equal(g2.body.subtitulo, 'Sub novo');
  assert.equal(g2.body.pisoReducao, 0.6);
  assert.deepEqual(g2.body.cores, { '--teal': '#0a7f6f', '--fundo': 'rgb(1, 2, 3)' });
});

test('POST aceita atualização parcial e piso nas bordas 0.5 e 1', async () => {
  assert.equal((await admin.post('/api/configuracoes', { pisoReducao: 0.5 })).status, 200);
  assert.equal((await admin.post('/api/configuracoes', { pisoReducao: 1 })).status, 200);
  assert.equal((await admin.get('/api/configuracoes')).body.pisoReducao, 1);
  assert.equal((await admin.post('/api/configuracoes', { pisoReducao: 0.83 })).status, 200);
});

test('POST rejeita valores inválidos com 400 e não grava nada', async () => {
  const antes = (await admin.get('/api/configuracoes')).body;
  for (const ruim of [
    { pisoReducao: 0.49 }, { pisoReducao: 1.01 }, { pisoReducao: '0.8' }, { pisoReducao: null },
    { emailTi: 'sem-arroba' }, { emailTi: 5 }, { emailTi: '' },
    { rodape: '' }, { rodape: 'x'.repeat(201) }, { subtitulo: 3 },
    { cores: 'azul' }, { cores: [] },
    { cores: { 'teal': '#fff' } },
    { cores: { '--teal': 'red;}body{display:none' } },
    { cores: { '--teal': 'url(http://x)' } },
    { cores: { '--teal': 5 } },
    { cores: { '--Teal': '#fff' } },
    { rodape: 'ok', pisoReducao: 7 },
  ]) {
    const r = await admin.post('/api/configuracoes', ruim);
    assert.equal(r.status, 400, JSON.stringify(ruim));
    assert.ok(r.body.erro);
  }
  assert.deepEqual((await admin.get('/api/configuracoes')).body, antes);
});

test('logo: PNG e JPEG são aceitos, guardados e devolvidos com o mime', async () => {
  assert.equal((await admin.get('/api/configuracoes/logo')).status, 404);
  const a = await enviarLogo(admin, png, 'image/png');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const g = await admin.agent.get('/api/configuracoes/logo').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(g.status, 200);
  assert.equal(g.headers['content-type'], 'image/png');
  assert.ok(g.body.equals(png));
  assert.equal((await enviarLogo(admin, jpg, 'image/jpeg')).status, 200);
  const g2 = await admin.get('/api/configuracoes/logo');
  assert.equal(g2.headers['content-type'], 'image/jpeg');
});

test('logo: SVG e outros tipos são rejeitados (415); assinatura falsa dá 400', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await enviarLogo(admin, svg, 'image/svg+xml')).status, 415);
  assert.equal((await enviarLogo(admin, Buffer.from('GIF89a....'), 'image/gif')).status, 415);
  assert.equal((await enviarLogo(admin, png, 'text/plain')).status, 415);
  assert.equal((await enviarLogo(admin, svg, 'image/png')).status, 400); // diz PNG mas não é
  assert.equal((await enviarLogo(admin, png, 'image/jpeg')).status, 400); // assinatura não bate com o tipo declarado
  assert.equal((await enviarLogo(admin, jpg, 'image/png')).status, 400);
  assert.equal((await enviarLogo(admin, Buffer.alloc(0), 'image/png')).status, 400);
  const g = await admin.get('/api/configuracoes/logo');
  assert.equal(g.headers['content-type'], 'image/jpeg'); // logo anterior intacto
});

test('logo: acima de 2 MB dá 413; sem token CSRF dá 403', async () => {
  const grande = Buffer.concat([PNG_SIG, Buffer.alloc(2 * 1024 * 1024 + 10, 1)]);
  assert.equal((await enviarLogo(admin, grande, 'image/png')).status, 413);
  const r = await admin.agent.put('/api/configuracoes/logo').set('Content-Type', 'image/png').send(png);
  assert.equal(r.status, 403);
});
