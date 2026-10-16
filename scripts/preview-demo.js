// Uso: node scripts/preview-demo.js [saida.html] [demo|overflow|tres] [a4|strip] -- renderiza o conteudo do PDF modelo (ou variacoes) para HTML.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderEdition } = require('../src/render/renderEdition');

const edicao = {
  numero: 1,
  mes_ano: '2026-10',
  titulo: 'Informações da TI para esta semana',
  subtitulo: 'Avisos rápidos, melhorias e orientações para as equipes do SENAR-RS.',
};
const destaque = {
  tipo: 'destaque',
  dados: {
    etiqueta: 'Destaque da semana',
    titulo: 'Abra seus chamados de TI pelo Help Desk Fluig',
    texto: 'Registre as solicitações de suporte no Help Desk Fluig. O sistema permite acompanhar o andamento dos chamados e ajuda a equipe a organizar as prioridades de atendimento.',
    chamada: 'Acesse o Fluig e abra um chamado sempre que precisar de suporte.',
  },
};
const cfpr = { tipo: 'card', dados: { etiqueta: 'CFPR', titulo: 'Comunicação no CFPR Campanha', texto: 'O Departamento de TI implantou o WhatsApp como novo canal para informações sobre treinamentos e inscrições da unidade.' } };
const rede = { tipo: 'card', dados: { etiqueta: 'REDE', titulo: 'Manutenção física da rede', texto: 'A rede recebeu manutenção preventiva, com atualização do cabeamento de algumas áreas e substituição de conectores .' } };
const dica = {
  tipo: 'dica',
  dados: {
    titulo: 'Dica de segurança: desconfie de e-mails urgentes',
    texto: 'Antes de abrir links ou anexos, confira o remetente. Em caso de dúvida, encaminhe a mensagem para a equipe de TI.',
  },
};
const longo = 'Texto longo para testar o estouro da página. '.repeat(6);
const cardLongo = (n) => ({ tipo: 'card', dados: { etiqueta: 'AREA ' + n, titulo: 'Card numero ' + n, texto: longo } });

const cenarios = {
  demo: [destaque, cfpr, rede, dica],
  tres: [destaque, cfpr, rede, cardLongo(3), dica],
  overflow: [destaque, ...[1, 2, 3, 4, 5, 6, 7, 8].map(cardLongo), dica],
};

const cenario = process.argv[3] || 'demo';
const mode = process.argv[4] || 'a4';
const saida = process.argv[2] || path.join(os.tmpdir(), `comunicado-${cenario}.html`);
const blocos = cenarios[cenario].map((b, i) => ({ id: i + 1, ordem: i + 1, ...b }));
fs.writeFileSync(saida, renderEdition({ edicao, blocos, mode }), 'utf8');
console.log(saida);
