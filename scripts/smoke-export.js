// Teste de fumaça do Chromium: renderiza uma edição de exemplo e valida PDF/PNGs.
// Uso: node --env-file=/etc/boletim/boletim.env scripts/smoke-export.js [diretorio-de-saida]
// (CHROMIUM_PATH e CHROMIUM_NO_SANDBOX vêm do ambiente; saída padrão: pasta temporária do sistema.)
// Abra o PDF/PNG gerados: o fim do bloco de dica ("Teste de glifos") deve mostrar ícones, não quadrados.
// Não usa banco. Código de saída 0 = tudo PASS, 1 = alguma falha.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExporter } = require('../src/export/exporter');
const { renderEdition } = require('../src/render/renderEdition');

const edicao = {
  numero: 1,
  mes_ano: '2026-10',
  titulo: 'Informações da TI para esta semana',
  subtitulo: 'Avisos rápidos, melhorias e orientações para as equipes do SENAR-RS.',
};
const blocos = [
  { tipo: 'destaque', dados: { etiqueta: 'Destaque da semana', titulo: 'Abra seus chamados de TI pelo Help Desk Fluig', texto: 'Registre as solicitações de suporte no Help Desk Fluig. O sistema permite acompanhar o andamento dos chamados e ajuda a equipe a organizar as prioridades de atendimento.', chamada: 'Acesse o Fluig e abra um chamado sempre que precisar de suporte.' } },
  { tipo: 'card', dados: { etiqueta: 'CFPR', titulo: 'Comunicação no CFPR Campanha', texto: 'O Departamento de TI implantou o WhatsApp como novo canal para informações sobre treinamentos e inscrições da unidade.' } },
  { tipo: 'card', dados: { etiqueta: 'REDE', titulo: 'Manutenção física da rede', texto: 'A rede recebeu manutenção preventiva, com atualização do cabeamento de algumas áreas e substituição de conectores.' } },
  { tipo: 'dica', dados: { titulo: 'Dica de segurança: desconfie de e-mails urgentes', texto: 'Antes de abrir links ou anexos, confira o remetente. Em caso de dúvida, encaminhe a mensagem para a equipe de TI. Teste de glifos: ✅ ⚠️ 📌 → ✓' } },
].map((b, i) => ({ id: i + 1, ordem: i + 1, ...b }));
const entrada = { edicao, blocos, settings: {}, logo: null };

const resultados = [];
function checar(nome, ok, detalhe) {
  resultados.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome} - ${detalhe}`);
}
const ihdr = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const ehPng = (b) => b.length > 24 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';

async function main() {
  const dir = path.resolve(process.argv[2] || os.tmpdir());
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Saída em: ${dir}`);
  console.log(`CHROMIUM_PATH=${process.env.CHROMIUM_PATH || '(autodetecção)'}  CHROMIUM_NO_SANDBOX=${process.env.CHROMIUM_NO_SANDBOX || '(não definido)'}`);
  const exporter = createExporter({ renderHtml: renderEdition });
  try {
    const pdf = await exporter.pdf(entrada);
    fs.writeFileSync(path.join(dir, 'comunicado-smoke.pdf'), pdf);
    const txt = pdf.toString('latin1');
    const paginas = (txt.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    checar('PDF com 1 página', pdf.subarray(0, 4).toString() === '%PDF' && paginas === 1, `${pdf.length} bytes, ${paginas} página(s)`);

    const email = await exporter.pngEmail(entrada);
    fs.writeFileSync(path.join(dir, 'comunicado-smoke-email.png'), email);
    const e = ehPng(email) ? ihdr(email) : { w: 0, h: 0 };
    checar('PNG e-mail 1240x1754', e.w === 1240 && e.h === 1754, `${email.length} bytes, ${e.w}x${e.h}`);

    const wa = await exporter.pngWhatsapp(entrada);
    fs.writeFileSync(path.join(dir, 'comunicado-smoke-whatsapp.png'), wa);
    const w = ehPng(wa) ? ihdr(wa) : { w: 0, h: 0 };
    checar('PNG WhatsApp A4 1080x1527', w.w === 1080 && w.h === 1527, `${wa.length} bytes, ${w.w}x${w.h}`);
  } catch (err) {
    checar('Exportação', false, `${err.name}: ${err.message}`);
    console.log('Dica: confira CHROMIUM_PATH; em Ubuntu 24.04/snap/contêiner tente CHROMIUM_NO_SANDBOX=1 (veja deploy/INSTALL.md).');
  } finally {
    await exporter.close().catch(() => {});
  }
  const ok = resultados.length === 3 && resultados.every(Boolean);
  console.log(ok ? 'RESULTADO: PASS' : 'RESULTADO: FAIL');
  process.exit(ok ? 0 : 1);
}

main();
