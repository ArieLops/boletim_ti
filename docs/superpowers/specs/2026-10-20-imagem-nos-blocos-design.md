# Imagem opcional nos blocos — Design

Data: 2026-10-20 · Status: desenho aprovado pelo usuário em conversa · Branch: `feat/imagem-nos-blocos` (a partir de `main` 9d6f773)

## 1. Objetivo
Cada bloco (**Destaque, Card, Dica, Texto livre**) ganha um campo **opcional** para enviar uma imagem. A imagem fica **alinhada à direita da caixa** e o texto corre à **esquerda e em volta dela**, como num jornal. Aparece igual na pré-visualização, no PDF, nos dois PNGs e na página do link público. Sem imagem, o bloco fica idêntico ao de hoje.

## 2. Decisões do usuário
- Largura **fixa, ~35% da caixa**; sem seletor de tamanho.
- Enquadramento: **mantém a proporção da foto** (sem recorte), com altura máxima.
- Armazenamento no **banco** ("tudo no banco", como no resto do sistema).
- Fora de escopo: legenda, escolha de tamanho, recorte, várias imagens por bloco, arrastar-e-soltar, galeria.

## 3. Arquitetura
### 3.1 Banco
Migração `003_imagens.sql` (aditiva, idempotente — `CREATE TABLE IF NOT EXISTS`, portável MariaDB/MySQL 8):
`imagens(id INT UNSIGNED AI PK, edicao_id INT UNSIGNED NOT NULL FK→edicoes ON DELETE CASCADE, mime VARCHAR(40) NOT NULL, conteudo LONGBLOB NOT NULL, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY (edicao_id))`.
A imagem anterior (1.1) continua funcionando com o banco migrado (a tabela nova é ignorada); ver §6 sobre rollback.

### 3.2 Bloco
`dados.imagem` = id numérico (inteiro positivo) da tabela `imagens`; opcional nos 4 tipos. `validateBlock` aceita `imagem` (só inteiro positivo; qualquer outro valor é descartado) e continua exigindo os campos de texto atuais. A imagem é atributo do **bloco**, não de um campo: ao **trocar o tipo** do bloco, a imagem é mantida.

### 3.3 Envio e leitura (rotas autenticadas, no Router com sessão/CSRF)
- `POST /edicoes/:id/imagens` — corpo cru (`image/png`, `image/jpeg`, `image/webp`), limite de **1 MB** (`413` acima). Só edição em **rascunho** (`409` se publicada); exige login e CSRF como as demais rotas. O tipo é validado **pelo conteúdo** (assinatura PNG / JPEG `FFD8FF` / WebP `RIFF....WEBP`), nunca pelo cabeçalho ou nome; qualquer outro tipo (inclui SVG, GIF) → `415`. No máximo **60 imagens por edição** (`409`) e, no salvamento, no máximo **30 blocos com imagem** (`400`). Os dois limites são separados porque imagens removidas ou substituídas ficam órfãs por 1 hora (§3.4) e contam no limite de envio; com um único limite de 30 quem experimenta imagens ficaria bloqueado. Resposta `201 {id}`.
- `GET /edicoes/:id/imagens/:imagemId` — bytes da imagem para a miniatura do editor (`Content-Type` do tipo validado, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`); `404` se a imagem não é dessa edição.
- Erros seguem o contrato JSON-vs-HTML existente (`erro(res, status, msg)`).

### 3.4 Salvamento (`saveEdition`)
Dentro da transação: as imagens referenciadas pelos blocos que **não pertencem à edição** são descartadas (o bloco fica sem imagem, mesma regra dos ids de bloco alheios). **Órfãs** (imagens da edição que nenhum bloco referencia) são apagadas só se tiverem **mais de 1 hora** — um envio recém-concluído não pode ser apagado por um salvamento que já estava em andamento.

### 3.5 Desenho do bloco (`renderEdition`)
- `renderEdition` recebe `imagens` (objeto `{ [id]: { mime, buffer } }`, só com imagens dos blocos da edição). `blocoHtml(b, imagens)`: se `b.dados.imagem` existe no mapa, insere como **primeiro filho** da caixa `<figure class="img-bloco"><img src="data:<mime>;base64,..." alt=""></figure>`; o `mime` vem de uma lista fixa (png/jpeg/webp). Sem imagem, o HTML do bloco é **idêntico** ao atual.
- CSS: `.img-bloco{float:right;width:35%;margin:0 0 8px 16px}`, `img{display:block;width:100%;height:auto;max-height:180px;object-fit:contain;object-position:right top;border-radius:6px}`; a caixa contém o float (`.bloco::after{content:"";display:block;clear:both}`) e a **linha de chamada** do Destaque usa `clear:both`. Valores com `s(...)` (escala) como o restante. Funciona nos modos `a4`, `strip` e `web` (na página pública a imagem vem embutida como `data:`, e a CSP já permite `img-src data:`).
- O ajuste automático para caber em 1 página A4 mede o conteúdo real, logo a altura da imagem já entra no cálculo; `fit`, PDF e PNGs não mudam.

### 3.6 Carregamento das imagens
`contextoExport` (pré-visualização, downloads, publicação) e a rota pública carregam as imagens referenciadas pelos blocos (`images.getMany(edicaoId, ids)`) e as passam a `renderEdition`. A página "em revisão" continua sem blocos nem imagens. Os arquivos publicados (PDF/PNGs) já nascem com a imagem embutida.

### 3.7 Editor
Em cada bloco (rascunho): campo **"Imagem (opcional)"** com escolha de arquivo (`accept="image/png,image/jpeg,image/webp"`), miniatura e botão **Remover imagem**. Ao escolher o arquivo, o navegador **reduz** a imagem antes de enviar (lado maior ≤ 800 px, mantendo PNG se a origem for PNG e usando JPEG 0,85 nos demais), envia, recebe o `id`, mostra a miniatura e marca a edição como alterada (salvamento automático). Edição publicada: só a miniatura, sem botões. Mensagens claras para tipo inválido, arquivo grande demais e falha de envio. Todo texto de erro entra por `textContent`; URLs via `Api.url` (guard de caminhos).

## 4. Segurança e limites
- Só PNG/JPEG/WebP por assinatura do arquivo; **SVG e GIF recusados** (SVG executa script). O `mime` guardado e usado no `data:` vem do tipo **detectado**, nunca do cabeçalho do cliente.
- Autenticação/CSRF como as demais rotas; só dono de sessão válida envia; só rascunho aceita envio.
- Posse da imagem verificada no envio, na leitura e no salvamento (uma edição nunca referencia imagem de outra).
- Limites: 1 MB por imagem, 60 imagens por edição (órfãs recentes contam), 30 blocos com imagem, redução no navegador (800 px). Na prática cabem cerca de 4 a 5 blocos com imagem por página A4; acima disso vale o fluxo existente de "conteúdo será cortado" (409 e confirmação).
- A página pública continua sem sessão/cookie; a imagem vai embutida no HTML, sem rota pública nova.

## 5. Testes
Unitários (detecção de tipo por assinatura, limites, redução de dimensões no navegador); migração (idempotente, duas execuções); repositório (`saveImage`, `getImage`, `getMany`, posse); rotas de envio (401, CSRF, 409 publicada, 413, 415 incl. SVG e GIF, assinatura falsa com `Content-Type` verdadeiro, limite de 60 envios, `GET` com posse); `saveEdition` (imagem alheia descartada, órfã recente mantida, órfã antiga apagada, trocar tipo mantém `dados.imagem`); render (imagem à direita antes do texto, `data:` do tipo detectado, sem imagem = HTML idêntico ao atual, escape); exportação real com imagem (PDF de 1 página, PNGs nos tamanhos A4); página pública com imagem; modo `/boletim_ti` (`Api.url`); guard de caminhos; suíte existente (377) intacta.

## 6. Rollback e compatibilidade
A tabela `imagens` é aditiva e a imagem Docker anterior continua subindo. **Porém**, a versão anterior descarta `dados.imagem` ao salvar uma edição (ela só conhece os campos de texto): depois de voltar, as imagens ficam no banco mas **desligadas dos blocos** nas edições salvas pela versão antiga. O guia `deploy/ATUALIZACAO.md` registra isso.

## 7. Fora de escopo
Legenda/alt-text editável (a imagem sai com `alt=""`), escolha de tamanho, recorte, mais de uma imagem por bloco, arrastar-e-soltar, imagens na lista de edições, exclusão de imagens órfãs por rotina agendada (só no salvamento).
