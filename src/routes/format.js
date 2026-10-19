// Formatação para as telas (texto em português). Valores de usuário NÃO são escapados aqui:
// o escape é feito pelo EJS (<%= %>) nas views.
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function mesAnoExtenso(mesAno) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mesAno || ''));
  return m && MESES[Number(m[2]) - 1] ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : String(mesAno || '');
}

const FMT_DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
function dataHora(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : FMT_DATA.format(dt).replace(',', '');
}

const numeroFmt = (n) => String(n).padStart(3, '0');

const ARQUIVOS = { pdf: 'o PDF', 'png-email': 'o PNG (e-mail)', 'png-whatsapp': 'a imagem (WhatsApp)' };

// Evento do histórico -> frase após o nome do usuário ("Ana" + "alterou o bloco ...").
function textoEvento(acao, detalhe) {
  const d = detalhe && typeof detalhe === 'object' ? detalhe : {};
  const bloco = d.titulo ? ` “${d.titulo}”` : '';
  switch (acao) {
    case 'edicao_criada': return 'criou a edição';
    case 'edicao_salva': return d.versao ? `salvou a edição (versão ${d.versao})` : 'salvou a edição';
    case 'bloco_criado': return `adicionou o bloco${bloco}`;
    case 'bloco_alterado': return `alterou o bloco${bloco}`;
    case 'bloco_reordenado': return `reordenou o bloco${bloco}`;
    case 'bloco_removido': return `removeu o bloco${bloco}`;
    case 'publicada': return 'publicou a edição';
    case 'link_publico_criado': return 'registrou: Link público criado';
    case 'reaberta': return 'reabriu a edição';
    case 'baixou': return `baixou ${ARQUIVOS[d.tipo] || 'um arquivo'}`;
    case 'status_alterado': return `alterou o status para ${d.status || '?'}`;
    default: return acao;
  }
}

module.exports = { mesAnoExtenso, dataHora, numeroFmt, textoEvento };
