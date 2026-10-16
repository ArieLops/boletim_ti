function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
const assinatura = (b) => stable({ tipo: b.tipo, dados: b.dados });
const tituloDe = (b) => (b.dados && b.dados.titulo) || '';

// Índices (em `seq`) que formam a maior subsequência crescente.
function lisIndices(seq) {
  const n = seq.length;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = -1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (best === -1 || len[i] > len[best]) best = i;
  }
  const keep = new Set();
  for (let i = best; i !== -1 && i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

function diffBlocks(antes, depois) {
  const eventos = [];
  const antesPorId = new Map(antes.filter((b) => b.id != null).map((b) => [b.id, b]));
  const idsDepois = new Set(depois.filter((b) => b.id != null).map((b) => b.id));
  const indiceAntes = new Map(antes.map((b, i) => [b.id, i]));

  const comuns = depois.filter((b) => b.id != null && antesPorId.has(b.id));
  const mantidos = lisIndices(comuns.map((b) => indiceAntes.get(b.id)));
  const reordenados = new Set(comuns.filter((_, i) => !mantidos.has(i)).map((b) => b.id));

  for (const b of depois) {
    if (b.id == null || !antesPorId.has(b.id)) {
      eventos.push({ acao: 'bloco_criado', blocoId: b.id ?? null, titulo: tituloDe(b) });
    } else if (assinatura(b) !== assinatura(antesPorId.get(b.id))) {
      eventos.push({ acao: 'bloco_alterado', blocoId: b.id, titulo: tituloDe(b) });
    } else if (reordenados.has(b.id)) {
      eventos.push({ acao: 'bloco_reordenado', blocoId: b.id, titulo: tituloDe(b) });
    }
  }
  for (const b of antes) {
    if (!idsDepois.has(b.id)) eventos.push({ acao: 'bloco_removido', blocoId: b.id, titulo: tituloDe(b) });
  }
  return eventos;
}

module.exports = { diffBlocks };
