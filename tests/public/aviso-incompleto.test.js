const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../../src/public/editor-lib');

const raiz = path.join(__dirname, '..', '..', 'src');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const base = { versao: 1, campos: { mesAno: '2026-10', titulo: 'T' } };

test('faltas: lista bloco (1-based), campo e motivo; completo => vazio', () => {
  const ok = { ...base, blocos: [{ tipo: 'texto', dados: { titulo: 'a', texto: 'b' } }] };
  assert.deepEqual(lib.faltas(ok), []);
  const ruim = {
    ...base,
    blocos: [
      { tipo: 'destaque', dados: { etiqueta: 'e', titulo: 't', texto: 'x', chamada: '  ' } },
      { tipo: 'card', dados: { etiqueta: '', titulo: '', texto: 'y'.repeat(2001) } },
    ],
  };
  assert.deepEqual(lib.faltas(ruim), [
    { bloco: 1, campo: 'chamada', motivo: 'vazio' },
    { bloco: 2, campo: 'etiqueta', motivo: 'vazio' },
    { bloco: 2, campo: 'titulo', motivo: 'vazio' },
    { bloco: 2, campo: 'texto', motivo: 'longo' },
  ]);
});

test('validarLocal: mensagens usam o rótulo do campo (e não o nome interno)', () => {
  const p = { ...base, blocos: [{ tipo: 'destaque', dados: { etiqueta: 'e', titulo: 't', texto: 'x', chamada: '' } }] };
  assert.deepEqual(lib.validarLocal(p), ['Bloco 1: preencha Linha de chamada.']);
});

test('editor: aviso ao lado da prévia e destaque dos campos faltantes estão ligados', () => {
  const ejs = ler('views', 'editor.ejs');
  assert.ok(/id="aviso-previa"[^>]*hidden/.test(ejs), 'falta o aviso ao lado da pré-visualização');
  assert.ok(ejs.indexOf('id="aviso-previa"') < ejs.indexOf('id="moldura"'), 'o aviso fica acima da prévia');
  const js = ler('public', 'editor.js');
  assert.ok(js.includes('marcarFaltas(L.faltas(payload))') && js.includes('avisoDaPrevia(problemas)'));
  assert.ok(js.includes('marcarFaltas([])') && js.includes('avisoDaPrevia([])'), 'o aviso some quando a edição volta a ser válida');
  assert.ok(ler('public', 'app.css').includes('.campo-invalido'));
});
