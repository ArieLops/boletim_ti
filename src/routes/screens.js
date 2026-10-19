// Telas HTML (lista, nova edição, editor, histórico, configurações). A API JSON fica nas outras rotas.
const express = require('express');
const { requireLogin, requireAdmin } = require('../auth/middleware');
const { CORES_PADRAO } = require('../render/styles');
const { rotuloEstadoLink } = require('../public/editor-lib');
const { mesAnoExtenso, dataHora, numeroFmt, textoEvento } = require('./format');

const TIPOS_BLOCO = [
  { tipo: 'destaque', rotulo: 'Destaque', descricao: 'Cartão grande com etiqueta, título, texto e linha de chamada. Para o assunto principal da semana.' },
  { tipo: 'card', rotulo: 'Card', descricao: 'Cartão menor com etiqueta, título e texto. Cards seguidos ficam lado a lado.' },
  { tipo: 'dica', rotulo: 'Dica', descricao: 'Faixa verde com ponto amarelo, título e texto. Para dicas de segurança e avisos curtos.' },
  { tipo: 'texto', rotulo: 'Texto livre', descricao: 'Título e parágrafo simples, sem caixa nem cor. Para texto corrido.' },
];
// [campo, rótulo, controle]
const CAMPOS_BLOCO = {
  destaque: [['etiqueta', 'Etiqueta', 'linha'], ['titulo', 'Título', 'linha'], ['texto', 'Texto', 'area'], ['chamada', 'Linha de chamada', 'linha']],
  card: [['etiqueta', 'Etiqueta', 'linha'], ['titulo', 'Título', 'linha'], ['texto', 'Texto', 'area']],
  dica: [['titulo', 'Título', 'linha'], ['texto', 'Texto', 'area']],
  texto: [['titulo', 'Título', 'linha'], ['texto', 'Parágrafo', 'area']],
};
const NOMES_CORES = {
  '--verde-escuro': 'Verde escuro (cabeçalho, títulos)', '--verde-medio': 'Verde médio', '--verde-claro': 'Verde claro',
  '--verde-palido': 'Verde pálido', '--teal': 'Verde-azulado (chamadas, dicas)', '--fundo': 'Fundo da página',
  '--card-fundo': 'Fundo dos cards', '--borda': 'Bordas', '--etiqueta-fundo': 'Fundo das etiquetas',
  '--amarelo': 'Amarelo (marcador da dica)', '--texto': 'Texto', '--texto-suave': 'Texto suave',
};

const ID = /^[1-9]\d{0,9}$/;

function naoEncontrada(res, mensagem = 'Edição não encontrada.') {
  return res.status(404).render('erro', { titulo: 'Não encontrada', mensagem });
}

// Carrega a edição de :id para as telas (404 HTML se malformado/desconhecido).
async function carregar(req, res, next) {
  if (!ID.test(req.params.id)) return naoEncontrada(res);
  const dados = await req.app.locals.editions.getEdition(Number(req.params.id));
  if (!dados) return naoEncontrada(res);
  req.dados = dados;
  next();
}

function screensRoutes() {
  const r = express.Router();
  const auxiliares = { mesAnoExtenso, dataHora, numeroFmt };
  const auxEditor = { ...auxiliares, rotuloEstadoLink };

  r.get('/', requireLogin, async (req, res) => {
    const edicoes = await req.app.locals.editions.listEditions();
    res.render('lista', { ...auxiliares, ativo: 'edicoes', edicoes });
  });

  // Antes de /edicoes/:id para que "nova" não seja tratado como id.
  r.get('/edicoes/nova', requireLogin, async (req, res) => {
    const sugerido = await req.app.locals.editions.nextNumber();
    const hoje = new Date();
    const mesAno = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    res.render('nova', { ativo: 'edicoes', sugerido, mesAno });
  });

  r.get('/edicoes/:id', requireLogin, carregar, (req, res) => {
    const { edicao, blocos } = req.dados;
    res.render('editor', {
      ...auxEditor, ativo: 'edicoes', edicao, blocos, travado: edicao.status === 'publicada',
      tiposBloco: TIPOS_BLOCO, camposBloco: CAMPOS_BLOCO,
    });
  });

  r.get('/edicoes/:id/historico', requireLogin, carregar, async (req, res) => {
    const eventos = (await req.app.locals.history.listHistory(req.dados.edicao.id)).map((e) => ({
      ...e, quando: dataHora(e.criado_em), frase: textoEvento(e.acao, e.detalhe),
    }));
    res.render('historico', { ...auxiliares, ativo: 'edicoes', edicao: req.dados.edicao, eventos });
  });

  r.get('/configuracoes', requireLogin, requireAdmin, async (req, res) => {
    const cfg = await req.app.locals.settings.getSettings();
    const cores = Object.entries(CORES_PADRAO).map(([nome, padrao]) => ({
      nome, padrao, rotulo: NOMES_CORES[nome] || nome, valor: (cfg.cores && cfg.cores[nome]) || padrao,
    }));
    res.render('configuracoes', { ativo: 'configuracoes', cfg, cores });
  });

  return r;
}

module.exports = { screensRoutes };
