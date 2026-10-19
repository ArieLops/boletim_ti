# Link público do comunicado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao publicar uma edição, gerar um link público fixo (`/p/<token>`) que abre, sem login, uma página com o comunicado e botões de download; o editor mostra o link com botão "Copiar".

**Architecture:** Migração aditiva adiciona `edicoes.token_publico`; `publicarTx` cria o token uma vez; um Router público (sem sessão/CSRF) montado antes do Router autenticado serve `/p/:token` e `/p/:token/baixar/:tipo` com cabeçalhos restritivos e limite de tentativas por IP; `renderEdition` ganha o modo `web` (responsivo); o editor exibe a faixa "Link público".

**Tech Stack:** Node.js ≥ 22.12, Express 5, EJS, mysql2, node:test + supertest, MariaDB de teste em `127.0.0.1:3307`.

**Spec:** `docs/superpowers/specs/2026-10-19-link-publico-design.md`

## Global Constraints
- Token: `crypto.randomBytes(16).toString('base64url')` (22 caracteres `[A-Za-z0-9_-]`), criado uma vez na primeira publicação, mantido em republicação/reabertura; formato validado por `^[A-Za-z0-9_-]{22}$` antes de consultar o banco.
- Rotas públicas: `GET /p/:token` e `GET /p/:token/baixar/:tipo` (`pdf|png-email|png-whatsapp`), montadas ANTES de sessão/CSRF/`loadUser`, sob o prefixo (`base || '/'`); sem `Set-Cookie`, sem linha de sessão; nada fora de `/p/…` ganha exceção de autenticação.
- Cabeçalhos das rotas públicas: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`.
- Token inexistente ou com formato inválido → mesma resposta 404 (corpo idêntico); edição com token em rascunho → 200 "em revisão" sem nenhum dado do rascunho; downloads só de edição publicada, bytes de `arquivos_publicados`.
- Limite por IP: `createThrottle({ max: 30, janelaMs: 10 * 60 * 1000 })`; cada token inválido/inexistente conta falha; bloqueado → 429 sem consultar o banco.
- Migração `002_link_publico.sql`: aditiva, idempotente, portável MariaDB 10.5+ e MySQL 8 (usar `information_schema` + `PREPARE/EXECUTE`; os comandos terminam com `;` no fim da linha por causa de `src/db/migrate.js`); a imagem 1.0 continua compatível.
- `normalizeBasePath` rejeita `/p` como primeiro segmento.
- Texto de usuário sempre escapado; nunca `<%-` com dados de usuário; `barraHtml` é string montada no servidor a partir de constantes + token validado.
- Prefixo: URLs internas sempre por `u()`/`Api.url` (guard de caminhos continua passando); o endereço completo do link é montado no navegador (`location.origin`).
- Testes de banco: cada arquivo define seu próprio `process.env.BOLETIM_TEST_DB` (prefixo `boletim_test`). `npm test` = `node --env-file=.env.test --test "tests/**/*.test.js"`; os 319 testes existentes continuam passando. Nunca `npm install`/`npm ci` sem necessidade (node_modules compartilhado).
- Commits no branch `feat/link-publico`; mensagens terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; sem push.

## Review Focus
1. Token adivinhável/previsível, reutilizado entre edições ou regenerado indevidamente na republicação.
2. A rota pública criar sessão/cookie, ou vazar rascunho, outra edição, editor ou dados de usuário (inclusive em "em revisão", 404 e erros).
3. Enumeração/força bruta de tokens sem limite; resposta diferente entre "inexistente" e "formato inválido"; temporização.
4. XSS na página pública (título, subtítulo, textos, etiquetas) e em `barraHtml`; CSP quebrando a própria página.
5. Migração não idempotente, quebrando em MySQL 8, ou travando o rollback para a imagem 1.0; modo prefixado (`/boletim_ti/p/…`) com links errados.

---

### Task 1: Banco, token e publicação

**Files:**
- Create: `src/db/migrations/002_link_publico.sql`, `src/domain/token.js`, `tests/db/migration-link-publico.test.js`, `tests/domain/token.test.js`, `tests/routes/publicar-token.test.js`
- Modify: `src/routes/exports.js` (`publicarTx`, resposta de publicar), `src/repos/editions.js` (só se o `SELECT` precisar expor `token_publico`; `SELECT *` já expõe), `src/base-path.js` (reservar `p`), `tests/base-path.test.js` (tabela de reservados)
- Test: os novos + suíte existente

**Interfaces:**
- Produces: `novoToken(): string` e `tokenValido(valor: unknown): boolean` em `src/domain/token.js`; coluna `edicoes.token_publico`; `POST /edicoes/:id/publicar` → `{status:'publicada', token: string}`; evento de histórico `link_publico_criado` `{ numero }` na primeira geração; `normalizeBasePath('/p')` lança `BASE_PATH inválido…`.
- Consumes: `insertEvent`, `files.saveFiles`, transação existente de `publicarTx`.

- [ ] **Step 1: Write the failing tests**
  - `tests/domain/token.test.js`: `novoToken()` tem 22 caracteres `[A-Za-z0-9_-]`; 1000 tokens sem repetição; `tokenValido` aceita um token gerado e rejeita `''`, `null`, número, 21/23 caracteres, caracteres fora do conjunto (`+`, `/`, `=`, espaço, `%`, `.`), string com `\n`.
  - `tests/db/migration-link-publico.test.js` (banco próprio `boletim_test_mig_link`): `migrate` aplica `001` e `002`; segunda chamada devolve `[]`; reaplicar o arquivo 002 manualmente sobre o banco migrado não falha (idempotência: apague a linha de `schema_migrations` de 002 e rode `migrate` de novo); `information_schema` mostra a coluna `token_publico` (nullable, `varchar(32)`) e o índice único `uq_edicoes_token_publico`; inserir dois tokens iguais falha (`ER_DUP_ENTRY`) e dois `NULL` são aceitos.
  - `tests/routes/publicar-token.test.js` (banco `boletim_test_publicar_token`, exportador falso, helpers `setup/entrar`): publicar devolve `token` válido e grava em `edicoes.token_publico`; o histórico tem um único `link_publico_criado`; reabrir e publicar de novo mantém o MESMO token e não cria novo evento; duas edições têm tokens diferentes; falha do exportador (503) não cria token; `GET` da página do editor de uma edição publicada expõe o token (a marcação fica para a Task 3 — aqui basta `getEdition(...).edicao.token_publico`); em `tests/base-path.test.js`: `/p` rejeitado e `/p2`, `/boletim_ti` aceitos.
- [ ] **Step 2: Run** `node --env-file=.env.test --test tests/domain/token.test.js tests/db/migration-link-publico.test.js tests/routes/publicar-token.test.js tests/base-path.test.js` → Expected: FAIL.
- [ ] **Step 3: Implement** `src/domain/token.js` (`novoToken` com `crypto.randomBytes(16).toString('base64url')`; `tokenValido` com regex ancorada, só para `typeof string`); `002_link_publico.sql` com comentário de topo explicando a portabilidade, coluna e índice condicionais via `information_schema` + `PREPARE/EXECUTE`; `publicarTx`: dentro da transação, `SELECT status, versao, token_publico … FOR UPDATE`, gerar token só se `NULL` (tentar de novo até 3 vezes em caso de `ER_DUP_ENTRY`), `UPDATE … SET status='publicada', atualizado_por=?, token_publico=?`, evento `link_publico_criado` apenas quando criado; devolver o token (existente ou novo) para a resposta; `src/base-path.js`: adicionar `p` à lista de primeiros segmentos reservados.
- [ ] **Step 4: Run** os testes novos e `npm test` completo → PASS (319 antigos + novos), saída limpa.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: token publico e migracao 002 (link publico, parte 1)"`

---

### Task 2: Rotas e página pública

**Files:**
- Create: `src/routes/public.js`, `src/views/publico-revisao.ejs`, `src/views/publico-404.ejs` (ou uma view `publico-aviso.ejs` com parâmetros), `tests/routes/public.test.js`, `tests/routes/public-base-path.test.js`
- Modify: `src/render/renderEdition.js` e `src/render/styles.js` (modo `web` + `barraHtml`), `src/app.js` (montar o Router público antes do Router com sessão), `src/repos/editions.js` (função `getByToken(token)` se não existir)
- Test: os novos + `tests/render/renderEdition.test.js` (casos do modo `web`)

**Interfaces:**
- Produces: `publicRoutes({ throttle? }): express.Router`; `editions.getByToken(token): Promise<{edicao, blocos} | null>`; `renderEdition({..., mode: 'web', barraHtml })`; `req.app.locals.publicThrottle` (instância de `createThrottle`, substituível em testes).
- Consumes: `tokenValido`, `files.getFile(edicaoId, tipoDb)`, `createThrottle`, `numeroFmt`, `res.locals.u`.

- [ ] **Step 1: Write the failing tests**
  - `tests/render/renderEdition.test.js` (acrescentar): modo `web` gera documento fluido (sem `height:297mm` fixo; `max-width` ~960px; regra de coluna única em tela estreita), mantém o escape de todos os campos, exibe `barraHtml` somente no modo `web` (nos modos `a4`/`strip` o parâmetro é ignorado), e `--escala` continua válido.
  - `tests/routes/public.test.js` (banco `boletim_test_public`, exportador falso, matriz raiz × `/boletim_ti` quando prático — o arquivo `public-base-path.test.js` cobre o prefixo): edição publicada → `GET /p/<token>` 200 `text/html` com título, blocos e três links de download `…/p/<token>/baixar/(pdf|png-email|png-whatsapp)`; NENHUM `Set-Cookie`; tabela `sessions` sem linhas novas após várias requisições; cabeçalhos exatos (`Cache-Control: no-store`, `X-Robots-Tag`, `Referrer-Policy`, `X-Content-Type-Options`, CSP da spec); reaberta (rascunho com token) → 200 "em revisão", corpo SEM o título/textos do rascunho; token inexistente com formato válido e token com formato inválido → 404 com corpo IDÊNTICO; `baixar/pdf|png-email|png-whatsapp` devolvem os bytes de `arquivos_publicados`, `Content-Disposition: attachment; filename="comunicado-001.pdf"` etc.; downloads de edição reaberta ou tipo desconhecido → 404; `<script>`/`<b>`/`&` em título, subtítulo e campos dos blocos aparecem escapados; 30 falhas seguidas do mesmo IP → a 31ª responde 429 sem consultar o banco (espie `pool.query`), e requisições válidas de OUTRO IP (`X-Forwarded-For` com `trust proxy`) continuam 200; uma requisição válida não conta como falha; rotas autenticadas (`/edicoes/1`) continuam exigindo login (302/401) e a 404 geral permanece.
  - `tests/routes/public-base-path.test.js` (banco `boletim_test_public_bp`): com `basePath: '/boletim_ti'`: `GET /boletim_ti/p/<token>` 200 e TODOS os links internos da página começam por `/boletim_ti/p/<token>/baixar/`; `GET /p/<token>` (sem prefixo) → 404; `GET /boletim_ti/p/<token>/baixar/pdf` devolve o PDF.
- [ ] **Step 2: Run** os novos testes → Expected: FAIL.
- [ ] **Step 3: Implement** o modo `web` e `barraHtml` em `renderEdition`/`styles` (documento completo, responsivo, sem JavaScript, estilos inline no próprio `<style>`; `barraHtml` inserido logo após `<body>`; o conteúdo do `<main>` não depende dele); `publicRoutes` (validação do formato, throttle por `req.ip`, `getByToken`, estados publicada/revisão/404, downloads, cabeçalhos via um middleware do próprio router, páginas de aviso simples e escapadas); `getByToken` (consulta parametrizada); em `src/app.js` montar `publicRoutes()` num Router que define `res.locals.u/basePath`, ANTES do `root` e sob `base || '/'`, sem tocar em sessão/CSRF/`loadUser`; instanciar `app.locals.publicThrottle`.
- [ ] **Step 4: Run** os testes novos + `npm test` completo (incluindo `tests/guard-paths.test.js`) → PASS.
- [ ] **Step 5: Verificação manual no navegador** (obrigatória): `scripts/dev-server.js` (e uma segunda vez com `BASE_PATH=/boletim_ti`, usando `MSYS_NO_PATHCONV=1` ou PowerShell) dirigido pelo Edge via `puppeteer-core`: publicar uma edição, abrir `/p/<token>` numa janela SEM cookies, ver o comunicado, clicar nos três downloads, reabrir a edição e ver "em revisão", publicar de novo e ver o mesmo link voltar, abrir no viewport de 390 px (sem rolagem horizontal), checar nos logs de rede que nenhuma requisição sai do prefixo; 3 capturas em `docs/superpowers/plans/assets/link-publico-*.png`.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: pagina publica do comunicado em /p/<token> (link publico, parte 2)"`

---

### Task 3: Editor (faixa "Link público"), histórico e guias

**Files:**
- Modify: `src/views/editor.ejs`, `src/public/editor.js` (só funções novas + ganchos em `publicar`/`reabrir`; não tocar linhas que montam URL além de `Api.url`), `src/public/app.css` (seção nova no fim), `src/views/historico.ejs` (rótulo do evento), `src/routes/screens.js` (passar o token à view se necessário), `deploy/ATUALIZACAO.md`, `README.md`, `docs/seguranca-dependencias.md` (nenhuma alteração salvo menção necessária)
- Create: `tests/routes/editor-link-publico.test.js`, `tests/public/link-publico.test.js`
- Test: os novos + suíte existente

**Interfaces:**
- Consumes: `edicao.token_publico`, resposta `{status, token}` de publicar, `Api.url`.
- Produces: elemento `#link-publico` (com `data-token`), campo somente leitura `#link-publico-url`, botão `#btn-copiar-link`; funções puras em `editor-lib.js`: `urlPublica(origem, base, token): string` e `rotuloEstadoLink(status, temToken): string`.

- [ ] **Step 1: Write the failing tests**
  - `tests/public/link-publico.test.js` (sem banco): `urlPublica('http://192.168.10.161', '/boletim_ti', 'abc…')` → `http://192.168.10.161/boletim_ti/p/abc…`; base `''` → `…/p/abc…`; origem com barra final não duplica; token inválido lança; `rotuloEstadoLink('publicada', true)` → texto "Link público"; `('rascunho', true)` → texto com "em revisão"; `(*, false)` → `''`.
  - `tests/routes/editor-link-publico.test.js` (banco `boletim_test_editor_link`): página do editor de edição publicada com token contém `id="link-publico"`, `data-token="<token>"`, campo `readonly`, botão "Copiar link"; rascunho com token mostra o aviso "em revisão"; edição sem token (nunca publicada) NÃO tem a faixa; token escapado; o histórico exibe "Link público criado" para o evento `link_publico_criado`; em modo prefixado os links do editor continuam com o prefixo (guard de caminhos passa).
- [ ] **Step 2: Run** → Expected: FAIL.
- [ ] **Step 3: Implement** a faixa no `editor.ejs` (somente quando há token; campo + botão "Copiar link"; texto de estado); em `editor.js` uma seção `// ---------- link público ----------` com: montagem da URL via `L.urlPublica(location.origin, Api.base, token)`, cópia (`navigator.clipboard.writeText` com alternativa por `select()` + `document.execCommand('copy')`), mensagem "Link copiado" anunciada em região `aria-live`, atualização da faixa quando `publicar()` volta com `token` e ao reabrir (estado "em revisão") sem recarregar; CSS no fim de `app.css`; rótulo do evento no histórico; `deploy/ATUALIZACAO.md`: corrigir a afirmação de que o schema é idêntico (agora há a migração aditiva `002`, que a imagem 1.0 ignora; incluir o `SELECT nome FROM schema_migrations` esperado com `001_init.sql` e `002_link_publico.sql`; em rollback o banco migrado continua válido para a 1.0) e atualizar o `docs/relatorio`-style resumo se houver menção; `README.md`: seção curta "Link público".
- [ ] **Step 4: Run** os novos testes + `npm test` completo → PASS.
- [ ] **Step 5: Verificação manual** (Edge): publicar → faixa com o link e "Copiar link" (conferir a área de transferência via `navigator.clipboard.readText` no teste do navegador, concedendo permissão), abrir o link copiado numa janela anônima, reabrir → faixa "em revisão" e link mostrando "em revisão", republicar → mesmo link; modo prefixado; teclado (Tab até o botão, Enter copia). 2 capturas `docs/superpowers/plans/assets/link-publico-editor-*.png`.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: faixa Link publico no editor, historico e guias (link publico, parte 3)"`

---

## Self-Review
- **Cobertura da spec:** §3.1–3.2 → Task 1; §3.3–3.4 → Task 2; §3.5 e guias → Task 3; §5 testes distribuídos.
- **Consistência:** `novoToken`/`tokenValido`, `getByToken`, `publicRoutes`, `urlPublica` definidos onde produzidos e usados com as mesmas assinaturas; token no corpo da resposta de publicar (`token`) consumido pelo editor.
- **Review Focus coberto:** (1) Task 1 testes de token/republicação; (2) Task 2 testes de cookie/sessão/rascunho; (3) Task 2 throttle e resposta idêntica; (4) Task 2 XSS e CSP na verificação manual; (5) Task 1 migração e Task 2 modo prefixado.
- **Proporção:** o plano define assinaturas, valores e testes; os corpos ficam com quem implementa.
