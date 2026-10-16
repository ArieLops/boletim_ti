// Reducao automatica: escolhe a maior escala (1.0, 0.95, ... ate o piso inclusive) em que o conteudo cabe.
// Aritmetica em centesimos inteiros para evitar deriva de ponto flutuante (0.85 sai exatamente 0.85).
async function pickScale(medirMm, { piso = 0.75, passo = 0.05, alturaMm = 297 } = {}) {
  const pisoC = Math.round(piso * 100);
  const passoC = Math.max(1, Math.round(passo * 100));
  const escalas = [];
  for (let c = 100; c >= pisoC; c -= passoC) escalas.push(c);
  if (escalas[escalas.length - 1] !== pisoC) escalas.push(pisoC);
  let medido = 0;
  for (const c of escalas) {
    medido = await medirMm(c / 100);
    if (medido <= alturaMm) return { scale: c / 100, estouro: false, faltaMm: 0 };
  }
  return { scale: pisoC / 100, estouro: true, faltaMm: Math.round((medido - alturaMm) * 10) / 10 };
}

module.exports = { pickScale };
