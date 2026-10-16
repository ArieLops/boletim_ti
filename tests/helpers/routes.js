// Apoio aos testes de rotas JSON: app + usuários + exportador falso + agente autenticado com CSRF.
const request = require('supertest');
const { resetTestDb } = require('./testdb');
const { createApp } = require('../../src/app');
const { makeUsersRepo } = require('../../src/repos/users');
const { ExportUnavailableError } = require('../../src/export/exporter');

const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const pngFake = (altura, tag) => {
  const b = Buffer.alloc(32);
  PNG_SIG.copy(b);
  b.writeUInt32BE(1080, 16);
  b.writeUInt32BE(altura, 20);
  b.write(tag, 24);
  return b;
};

// Exportador falso: mesmos métodos do real, resultados pequenos e controláveis.
function fakeExporter() {
  let n = 0;
  const ex = {
    calls: { fit: 0, pdf: 0, pngEmail: 0, pngWhatsapp: 0, whatsappInfo: 0 },
    pisos: [],
    fitResult: { scale: 1, estouro: false, faltaMm: 0 },
    info: { largura: 1080, altura: 1500, muitoAlta: false },
    indisponivel: false,
    falhaEm: null,
    async close() {},
  };
  const guard = (nome) => {
    if (ex.indisponivel || ex.falhaEm === nome) throw new ExportUnavailableError('Chromium indisponível (falso)');
  };
  ex.fit = async (_i, o) => { ex.calls.fit++; ex.pisos.push(o && o.piso); guard('fit'); return ex.fitResult; };
  ex.pdf = async (_i, o) => { ex.calls.pdf++; ex.pisos.push(o && o.piso); guard('pdf'); return Buffer.from(`%PDF-fake-${++n}`); };
  ex.pngEmail = async (_i, o) => { ex.calls.pngEmail++; ex.pisos.push(o && o.piso); guard('pngEmail'); return pngFake(1754, `em${++n}`); };
  ex.pngWhatsapp = async () => { ex.calls.pngWhatsapp++; guard('pngWhatsapp'); return pngFake(ex.info.altura, `wa${++n}`); };
  ex.whatsappInfo = async () => { ex.calls.whatsappInfo++; guard('whatsappInfo'); return ex.info; };
  ex.reset = () => { for (const k of Object.keys(ex.calls)) ex.calls[k] = 0; ex.pisos.length = 0; };
  return ex;
}

async function setup({ exporter } = {}) {
  process.env.BCRYPT_COST ??= '4';
  const pool = await resetTestDb();
  const users = makeUsersRepo(pool);
  const app = createApp({ pool, exporter, cookieSecure: false, sessionSecret: 'segredo-de-teste', sessionHours: 1 });
  const ed = await users.createUser({ nome: 'Edu', login: 'edu', senha: 'senha-edu-123', perfil: 'editor' });
  await users.setPassword(ed, 'senha-edu-123');
  const ed2 = await users.createUser({ nome: 'Ana <Editora>', login: 'ana', senha: 'senha-ana-123', perfil: 'editor' });
  await users.setPassword(ed2, 'senha-ana-123');
  const ad = await users.createUser({ nome: 'Admin', login: 'admin', senha: 'senha-admin-123', perfil: 'administrador' });
  await users.setPassword(ad, 'senha-admin-123');
  return {
    pool, users, app, ids: { edu: ed, ana: ed2, admin: ad },
    async close() { await app.locals.close(); await pool.end(); },
  };
}

// Entra e devolve agente + token CSRF (lido da página inicial) + atalhos JSON.
async function entrar(app, login, senha) {
  const agent = request.agent(app);
  const pg = await agent.get('/login');
  const t0 = /name="_csrf" value="([^"]+)"/.exec(pg.text)[1];
  const r = await agent.post('/login').type('form').send({ login, senha, _csrf: t0 });
  if (r.status !== 302) throw new Error(`login falhou: ${r.status}`);
  const home = await agent.get('/');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(home.text)[1];
  const send = (m) => (url, body) => {
    const q = agent[m](url).set('X-CSRF-Token', csrf);
    return body === undefined ? q : q.send(body);
  };
  return { agent, csrf, get: (u) => agent.get(u), post: send('post'), put: send('put') };
}

const blocoCard = (n = 1, extra = {}) => ({ tipo: 'card', dados: { etiqueta: `E${n}`, titulo: `Título ${n}`, texto: `Texto ${n}` }, ...extra });

module.exports = { setup, entrar, fakeExporter, blocoCard, pngFake, PNG_SIG };
