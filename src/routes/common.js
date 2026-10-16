// Utilitários compartilhados pelas rotas JSON de edições, exportação e configurações.
const { ExportUnavailableError } = require('../export/exporter');

const erro = (res, status, mensagem, extra = {}) => res.status(status).json({ erro: mensagem, ...extra });

// Carrega a edição de `:id` (404 se o id for malformado ou desconhecido) em req.dados = {edicao, blocos}.
async function carregarEdicao(req, res, next) {
  const bruto = req.params.id;
  if (!/^[1-9]\d{0,9}$/.test(bruto)) return erro(res, 404, 'edição não encontrada');
  const dados = await req.app.locals.editions.getEdition(Number(bruto));
  if (!dados) return erro(res, 404, 'edição não encontrada');
  req.dados = dados;
  next();
}

function exportador(req) {
  const ex = req.app.locals.exporter;
  if (!ex) throw new ExportUnavailableError('Exportador não configurado neste servidor.');
  return ex;
}

// Entrada do exportador/renderizador + opções por requisição (o piso vem das configurações vigentes).
async function contextoExport(req) {
  const { settings } = req.app.locals;
  const [cfg, logo] = await Promise.all([settings.getSettings(), settings.getLogo()]);
  const { edicao, blocos } = req.dados;
  return { input: { edicao, blocos, settings: cfg, logo }, opts: { piso: cfg.pisoReducao }, settings: cfg };
}

const numeroFmt = (n) => String(n).padStart(3, '0');

// Erros do exportador viram 503 com mensagem clara; os demais seguem para o tratador geral.
function trataExportador(res, err) {
  if (err instanceof ExportUnavailableError) {
    erro(res, 503, err.message);
    return true;
  }
  return false;
}

module.exports = { erro, carregarEdicao, exportador, contextoExport, numeroFmt, trataExportador, ExportUnavailableError };
