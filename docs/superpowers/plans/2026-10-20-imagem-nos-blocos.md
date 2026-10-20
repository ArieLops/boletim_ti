# Imagem opcional nos blocos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada bloco (Destaque, Card, Dica, Texto livre) aceita uma imagem opcional, alinhada à direita da caixa com o texto correndo à esquerda, em todas as saídas (prévia, PDF, PNGs, link público).

**Architecture:** Tabela `imagens` no banco (envio separado do salvamento; o bloco guarda só `dados.imagem` = id). `renderEdition` recebe um mapa `imagens` e embute cada imagem como `data:` (como já faz com a logo) num `<figure>` flutuante à direita. O navegador reduz a imagem antes de enviar.

**Tech Stack:** Node 22, Express 5, EJS, JS de navegador sem build, mysql2, node:test + supertest, MariaDB (testes em 127.0.0.1:3307), Chromium/Edge para exportar.

**Spec:** `docs/superpowers/specs/2026-10-20-imagem-nos-blocos-design.md` (autoridade; este plano argumenta a partir dela).

## Global Constraints
- Tipos aceitos: **PNG, JPEG, WebP**, validados pela **assinatura do conteúdo**; SVG/GIF/outros → 415. Limite **2 MB** (413) e **30 imagens por edição** (409).
- Envio só em edição **rascunho** (409 se publicada); login + CSRF (`X-CSRF-Token`) como as outras rotas; erros pelo contrato `erro(res, status, msg)`.
- `dados.imagem` = inteiro positivo ou ausente; imagem de **outra edição** é descartada no salvamento; órfãs só apagadas se tiverem **> 1 hora**.
- Largura da figura **35%** da caixa, `max-height: 180px` (com `s(...)` da escala), proporção mantida (`object-fit:contain`), à direita; sem imagem o HTML do bloco é **idêntico** ao atual (os 377 testes existentes continuam passando).
- Todas as URLs internas via `u()` / `Api.url` (tests/guard-paths.test.js); texto de erro no navegador só por `textContent`.
- Migração `003_imagens.sql` idempotente (`CREATE TABLE IF NOT EXISTS`), compatível com MariaDB 10.5 e MySQL 8; `src/db/migrate.js` divide por `;` no fim da linha (nada de `;` seguido de quebra de linha em literais).
- Arquivos de texto do projeto usam CRLF em parte do código: preserve o fim de linha de cada arquivo ao editar.
- Não fazer push nem merge sem pedido do usuário.

## Review Focus
- SVG/GIF/arquivo falso (assinatura diferente do `Content-Type`) não entram, mesmo com cabeçalho "image/png".
- Salvamento concorrente com um envio recém-concluído não pode apagar a imagem nova (regra das 1 hora).
- Trocar o tipo do bloco mantém a imagem; remover o bloco não deixa a imagem referenciada por outro.
- Edição com 20+ blocos com imagem ainda gera PDF de 1 página (reduz a escala) e página pública leve o bastante para abrir.
- Página pública e "em revisão": nada do rascunho (nem imagens) vaza; página pública sem cookie.
- Voltar para a imagem anterior (rollback) não quebra o banco; `deploy/ATUALIZACAO.md` avisa que `dados.imagem` é descartado ao salvar na versão antiga.

---

### Task 1: Banco, domínio e rotas de imagem (backend)

**Files:**
- Create: `src/db/migrations/003_imagens.sql`, `src/domain/imagem.js`, `src/repos/images.js`, `src/routes/images.js`
- Modify: `src/domain/blocks.js`, `src/repos/editions.js` (`saveEdition`), `src/app.js` (monta `imagesRoutes()` no Router com sessão e `app.locals.images`)
- Test: `tests/domain/imagem.test.js`, `tests/db/migration-imagens.test.js`, `tests/routes/imagens.test.js`, `tests/repos/images.test.js`, ajustar `tests/db/migrate.test.js` (lista de migrações)

**Interfaces:**
- Produces: `imagem.detectarMime(buf) → 'image/png'|'image/jpeg'|'image/webp'|null`; constantes `MAX_BYTES = 2*1024*1024`, `MAX_POR_EDICAO = 30`.
- Produces: `makeImagesRepo(pool)` com `saveImage(edicaoId, {mime, buffer}) → id`, `getImage(edicaoId, id) → {mime, buffer}|null`, `getMany(edicaoId, ids) → { [id]: {mime, buffer} }` (só imagens da edição), `countByEdition(edicaoId) → number`.
- Produces: `validateBlock(tipo, dados)` passa a devolver `dados.imagem` (inteiro positivo) quando presente em `entrada.imagem`; qualquer outro valor é descartado. `saveEdition` mantém a regra de posse/órfãs do spec §3.4.
- Rotas: `POST /edicoes/:id/imagens` → `201 {id}`; `GET /edicoes/:id/imagens/:imagemId` → bytes.

- [ ] **Step 1: Testes que falham.** `imagem.test.js`: assinatura PNG/JPEG/WebP válidas → mime; SVG (`<svg`), GIF, vazio, texto → `null`. `migration-imagens.test.js`: duas execuções da `003` não falham e a tabela existe. `imagens.test.js` (supertest, mesmo `setup`/`entrar` de `tests/helpers/routes.js`): 401 sem login; 403 sem CSRF; 201 com PNG real (bytes mínimos válidos) e `GET` devolve os mesmos bytes com `Content-Type: image/png` e `X-Content-Type-Options: nosniff`; 415 para SVG e GIF (mesmo com `Content-Type: image/png`) e para corpo de texto com `Content-Type: image/png`; corpo com assinatura PNG enviado como `Content-Type: image/jpeg` é aceito e guardado como `image/png` (o mime vem da assinatura); 413 acima de 2 MB; 409 em edição publicada; 409 ao passar de 30; `GET` de imagem de outra edição → 404. `blocks`/`editions`: `validateBlock` preserva `imagem: 7`, descarta `imagem: "x"`/`-1`/`1.5`; `saveEdition` descarta imagem de outra edição, mantém órfã recente e apaga órfã com `criado_em` de 2 horas atrás, e mantém `dados.imagem` ao trocar o tipo.
- [ ] **Step 2: Rodar e ver falhar** — `npm test` (os novos falham).
- [ ] **Step 3: Implementar** a migração (`imagens(id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, edicao_id INT UNSIGNED NOT NULL, mime VARCHAR(40) NOT NULL, conteudo LONGBLOB NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_imagens_edicao (edicao_id), CONSTRAINT fk_imagens_edicao FOREIGN KEY (edicao_id) REFERENCES edicoes (id) ON DELETE CASCADE)` com `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`), `detectarMime`, o repositório, as rotas (modelo: `PUT /api/configuracoes/logo` em `src/routes/settings.js` — `express.raw({ type: ['image/png','image/jpeg','image/webp'], limit: '2mb' })`; o 415 vale quando o corpo não é Buffer/o tipo não casa; o mime guardado é o **detectado**), a regra de `imagem` em `validateBlock` e em `saveEdition` (dentro da transação, depois de `validados`: manter só ids existentes em `imagens` dessa edição; apagar órfãs com `criado_em < NOW() - INTERVAL 1 HOUR`). `GET` envia `Cache-Control: private, max-age=3600`.
- [ ] **Step 4: Rodar tudo** — `npm test` completo passa (inclui `tests/guard-paths.test.js`).
- [ ] **Step 5: Commit** — `feat: tabela de imagens e rotas de envio (imagem nos blocos, parte 1)`.

### Task 2: Desenho do bloco com imagem em todas as saídas

**Files:**
- Modify: `src/render/renderEdition.js` (`blocoHtml`, `corpoHtml`, `renderEdition`), `src/render/styles.js`, `src/routes/common.js` (`contextoExport`), `src/routes/public.js`
- Test: `tests/render/renderEdition.test.js` (casos novos), `tests/routes/imagens-saidas.test.js`, ajuste de `tests/helpers/routes.js` se o exportador falso precisar do mapa

**Interfaces:**
- Consumes: `app.locals.images.getMany(edicaoId, ids)` e `dados.imagem` (Task 1).
- Produces: `renderEdition({ ..., imagens })` com `imagens: { [id]: { mime, buffer } }` (opcional; `{}` por padrão); HTML da figura `<figure class="img-bloco"><img src="data:<mime>;base64,..." alt=""></figure>` como **primeiro filho** de `.bloco`, só para mimes da lista fixa.
- `contextoExport(req)` passa a devolver `input.imagens` (apenas imagens dos blocos da edição).

- [ ] **Step 1: Testes que falham.** Render: bloco de cada tipo com `dados.imagem` presente no mapa → `<figure class="img-bloco">` antes do texto e `data:image/png;base64,` com o buffer; mime fora da lista (ex.: `image/svg+xml`) → sem figura; id ausente no mapa → sem figura; sem imagem → HTML **igual** ao de hoje (comparar com o render sem a chave); CSS contém `.img-bloco` com `float:right` e `width` de 35%, e a chamada do destaque tem `clear:both`. Rotas: prévia de edição com imagem contém o `data:`; página pública de edição publicada com imagem contém a imagem e **não** envia `Set-Cookie`; "em revisão" não contém imagem. Exportação **real** (padrão de `tests/routes/publish-real.test.js`): edição com 4 blocos com imagem → PDF de 1 página e PNGs 1240×1754 e 1080×1527.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** `blocoHtml(b, imagens)` insere a figura; CSS com `s(...)`: `.img-bloco{float:right;width:35%;margin:0 0 s(8) s(16)}`, `.img-bloco img{display:block;width:100%;height:auto;max-height:s(180);object-fit:contain;object-position:right top;border-radius:s(6)}`, `.bloco::after{content:"";display:block;clear:both}`, `.bloco-destaque .chamada{clear:both}`. `contextoExport` e a rota pública carregam as imagens dos blocos (`ids = blocos.map(b => b.dados.imagem).filter(Number.isInteger)`).
- [ ] **Step 4: Verificação visual** — gerar com o Edge um comunicado com 1 imagem em cada tipo (destaque, 2 cards, dica, texto livre) e salvar 2 capturas em `docs/superpowers/plans/assets/imagem-blocos-a4.png` e `imagem-blocos-web.png`; conferir que o texto corre à esquerda, a imagem fica à direita e nada estoura.
- [ ] **Step 5: Rodar tudo** — `npm test` passa.
- [ ] **Step 6: Commit** — `feat: imagem alinhada a direita nos blocos em todas as saidas (parte 2)`.

### Task 3: Editor, trocar tipo, guias

**Files:**
- Modify: `src/views/partials/bloco.ejs`, `src/public/editor.js`, `src/public/editor-lib.js`, `src/public/app.css`, `src/routes/screens.js` (se precisar do id da edição na view), `deploy/ATUALIZACAO.md`, `README.md`
- Test: `tests/public/imagem-editor.test.js`, `tests/routes/editor-imagem.test.js`

**Interfaces:**
- Consumes: `POST/GET /edicoes/:id/imagens` (Task 1).
- Produces: `editor-lib`: `dimensoesReducao(largura, altura, maximo) → {largura, altura}` (lado maior ≤ `maximo`, sem ampliar) e `tipoImagemPermitido(mime) → boolean` (png/jpeg/webp).
- DOM: cada `.bloco-item` ganha `.bloco-imagem` com `input[type=file]`, `img` de miniatura (`src` via `Api.url('/edicoes/' + ID + '/imagens/' + id)`), botão `data-acao="remover-imagem"` e o id em `data-imagem` do `li`; `lerBloco(li)` inclui `imagem` em `dados` quando houver.

- [ ] **Step 1: Testes que falham.** `editor-lib`: `dimensoesReducao(4000, 3000, 1200)` → 1200×900; `(800, 600, 1200)` → 800×600 (não amplia); `(600, 4800, 1200)` → 150×1200; `tipoImagemPermitido` aceita png/jpeg/webp e recusa svg/gif/vazio. Rotas de tela: o editor de rascunho tem `.bloco-imagem` com `accept="image/png,image/jpeg,image/webp"` em cada bloco e em cada `<template id="tpl-...">`; bloco com `dados.imagem` mostra a miniatura com `src` prefixado pela base (modo raiz e `/boletim_ti`); edição **publicada** mostra a miniatura sem input nem botão de remover. `trocar tipo` mantém `data-imagem`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Ao escolher o arquivo: valida tipo/tamanho, reduz com `canvas` (PNG se a origem for PNG, senão JPEG 0,85; lado maior ≤ 1200), envia com `fetch` (`Api.url`, `Api.cabecalhos`, corpo `Blob`), em sucesso grava `data-imagem`, mostra a miniatura e chama `marcarSujo()`; em erro mostra a mensagem do servidor por `textContent` (`aviso(...)` ou área do bloco). **Remover imagem** limpa `data-imagem`/miniatura e marca como alterado. `trocarTipoBloco` copia `data-imagem` do `li` antigo para o novo. CSS no fim de `app.css`. `deploy/ATUALIZACAO.md`: nota da migração `003` e do rollback (§6 do spec); `README.md`: seção curta "Imagem nos blocos".
- [ ] **Step 4: Verificação manual no navegador** (servidor `scripts/dev-server.js`): enviar uma foto grande, ver a miniatura, ver a prévia com a imagem à direita, trocar o tipo do bloco (mantém), remover, publicar e baixar o PDF; capturas `docs/superpowers/plans/assets/imagem-editor.png`. Encerrar o servidor.
- [ ] **Step 5: Rodar tudo** — `npm test` passa.
- [ ] **Step 6: Commit** — `feat: campo de imagem nos blocos do editor, guias (parte 3)`.
