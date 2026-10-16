# Comunicado Semanal SENAR-RS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema web interno onde a TI cadastra as edições do Comunicado Semanal em blocos e exporta PDF A4, PNG A4 e PNG em tira (WhatsApp), tudo guardado em MySQL.

**Architecture:** Aplicação Node.js/Express com MySQL. Um renderizador gera um único HTML por edição; um exportador com Chromium headless (Puppeteer, fila serial) mede esse HTML, aplica a redução automática e produz PDF/PNGs. Edições publicadas têm os 3 arquivos gravados em LONGBLOB. UI em HTML renderizado no servidor (EJS) com JS puro, sem etapa de build.

**Tech Stack:** Node.js 20+, Express, EJS, mysql2, bcryptjs, express-session + express-mysql-session, Puppeteer, `node:test` + supertest.

**Spec:** `docs/superpowers/specs/2026-10-16-comunicado-semanal-design.md`

## Global Constraints

- Servidor Ubuntu, nginx na frente (HTTPS), Node.js 20+, MySQL/MariaDB; Apache não é usado.
- Página A4 = 210×297 mm. PNG e-mail = 1240×1754 px (150 dpi). PNG WhatsApp = 1080 px de largura, altura conforme conteúdo, sem redução.
- Redução automática: passos de 5% (100 → 95 → … ), piso padrão 75%, configurável. Passou do piso: marca "passou do limite", informa quanto falta cortar; exportar A4 exige confirmação ("conteúdo será cortado").
- Blocos: `destaque` (etiqueta, título, texto, chamada), `card` (etiqueta, título, texto), `dica` (título, texto), `texto` (título, parágrafo). Cards consecutivos ficam em 2 colunas.
- Cabeçalho fixo: "SENAR", "RIO GRANDE DO SUL", "Comunicado semanal", logo; linha de edição "TECNOLOGIA DA INFORMAÇÃO · EDIÇÃO 001 · OUTUBRO/2026"; rodapé "TI SENAR-RS" + e-mail da TI (padrão `informatica@senar-rs.com.br`). Editáveis em Configurações.
- Perfis: `editor` e `administrador`. Senhas bcrypt; cookie `httpOnly`, `secure`, `sameSite`; bloqueio temporário após tentativas inválidas repetidas; troca de senha obrigatória no primeiro acesso; desativar conta preserva histórico.
- Edição publicada fica travada até ser reaberta; reabrir invalida os arquivos guardados. Concorrência otimista por `versao`: mensagem "esta edição foi alterada por <usuário>, recarregue".
- Tudo no MySQL: dados, logo e arquivos publicados (LONGBLOB). `max_allowed_packet` ≥ 16 MB. Usuário MySQL dedicado, nunca root.
- Fonte sans-serif embutida (arquivo no projeto), cores como variáveis CSS tiradas do PDF modelo (verde escuro, verde médio, verde claro, fundo off-white).
- Fora do escopo: AD/Microsoft 365, envio automático de e-mail/WhatsApp, agendamento.

## Review Focus

1. Texto com `<script>`, `<b>` ou `&` em qualquer campo → aparece como texto literal, nunca executa nem quebra o layout (escape no renderizador).
2. Edição sem nenhum bloco → renderiza cabeçalho e rodapé, exporta sem erro, preview mostra "Edição vazia".
3. Palavra gigante sem espaços (URL longa) ou parágrafo enorme → não estoura a largura do card; entra na redução/aviso de limite.
4. Número ímpar de cards seguidos → o último ocupa a linha inteira, sem buraco.
5. Duas exportações simultâneas e Chromium indisponível → fila serial responde as duas; falha vira mensagem clara (HTTP 503), não derruba o serviço.

---

## File Structure

```
package.json  .env.example  .gitignore
src/config.js
src/server.js                      # monta o app e sobe a porta
src/app.js                         # createApp(): Express app (testável)
src/db/pool.js  src/db/migrate.js  src/db/migrations/001_init.sql
src/auth/passwords.js  src/auth/middleware.js  src/auth/throttle.js
src/repos/users.js  editions.js  history.js  files.js  settings.js
src/domain/blocks.js               # tipos e validação
src/domain/diff.js                 # diff de blocos para histórico
src/render/renderEdition.js        # HTML único da edição
src/render/styles.js               # CSS (variáveis de cor, escala)
src/render/assets/                 # fonte .woff2, logo padrão
src/export/fit.js                  # pickScale (puro)
src/export/exporter.js             # Puppeteer + fila serial
src/routes/auth.js editions.js exports.js users.js settings.js
src/views/*.ejs                    # login, lista, editor, histórico, usuários, config
src/public/editor.js  app.css
scripts/create-admin.js
deploy/boletim.service  boletim.nginx.conf  backup.sh  INSTALL.md
tests/**                           # espelha src/
```

Testes usam um banco MySQL separado (`BOLETIM_TEST_DB`), recriado a cada suíte. Rodar: `npm test` (`node --test tests/`).

---

### Task 1: Scaffold, configuração, banco e migrações

**Files:**
- Create: `package.json`, `.env.example`, `.gitignore`, `src/config.js`, `src/db/pool.js`, `src/db/migrate.js`, `src/db/migrations/001_init.sql`, `tests/helpers/testdb.js`
- Test: `tests/db/migrate.test.js`

**Interfaces:**
- Produces: `config` (objeto: `port`, `db{host,user,password,database}`, `sessionSecret`, `sessionHours`, `minScale` default `0.75`); `getPool(): mysql2 Pool`; `closePool(): Promise<void>`; `migrate(pool): Promise<string[]>` (nomes aplicados nesta chamada); `resetTestDb(): Promise<Pool>` em `tests/helpers/testdb.js` (dropa e recria o banco de teste, roda `migrate`).
- Tabelas de `001_init.sql`: `usuarios(id, nome, login UNIQUE, senha_hash, perfil ENUM('editor','administrador'), ativo, trocar_senha, criado_em)`, `edicoes(id, numero UNIQUE, mes_ano, titulo, subtitulo, status ENUM('rascunho','publicada'), versao, criado_por, atualizado_por, criado_em, atualizado_em)`, `blocos(id, edicao_id, tipo, ordem, dados JSON)`, `historico(id, edicao_id, usuario_id, acao, detalhe JSON, criado_em)`, `arquivos_publicados(id, edicao_id, tipo ENUM('pdf','png_email','png_whatsapp'), conteudo LONGBLOB, gerado_por, gerado_em, UNIQUE(edicao_id,tipo))`, `configuracoes(chave PK, valor TEXT)`, `logo(id=1, conteudo LONGBLOB, mime)`, `schema_migrations(nome PK, aplicada_em)`.

- [ ] **Step 1:** `git init`; criar `package.json` (type `commonjs`, scripts `start`, `test`), instalar dependências do Tech Stack; `.gitignore` com `node_modules`, `.env`.
- [ ] **Step 2: Write the failing test** `tests/db/migrate.test.js`: `migrate` numa base vazia retorna `['001_init.sql']`; segunda chamada retorna `[]`; `SHOW TABLES` contém as 8 tabelas acima.
- [ ] **Step 3: Run** `node --test tests/db/migrate.test.js` → Expected: FAIL (módulo não existe).
- [ ] **Step 4:** Implementar `config.js` (lê `.env` via `process.env`, falha com mensagem clara se faltar `SESSION_SECRET` ou `DB_*`), `pool.js`, `migrate.js` (lê `*.sql` em ordem alfabética, aplica só os ausentes em `schema_migrations`, uma transação por arquivo), `001_init.sql`, `testdb.js`.
- [ ] **Step 5: Run** o teste → Expected: PASS.
- [ ] **Step 6: Commit** `git add . && git commit -m "feat: scaffold, config e migracoes MySQL"`

---

### Task 2: Usuários, login, perfis e primeiro administrador

**Files:**
- Create: `src/auth/passwords.js`, `src/auth/throttle.js`, `src/auth/middleware.js`, `src/repos/users.js`, `src/routes/auth.js`, `src/routes/users.js`, `src/app.js`, `scripts/create-admin.js`
- Test: `tests/repos/users.test.js`, `tests/auth/throttle.test.js`, `tests/routes/auth.test.js`

**Interfaces:**
- Consumes: `getPool`, `config`.
- Produces:
  - `hashPassword(senha: string): Promise<string>`, `checkPassword(senha, hash): Promise<boolean>` (bcryptjs, custo 12).
  - `createUser({nome, login, senha, perfil}): Promise<number>` (`trocar_senha=1`), `verifyLogin(login, senha): Promise<User|null>` (null se inativo ou senha errada), `setPassword(id, senha)` (zera `trocar_senha`), `setActive(id, ativo: boolean)`, `listUsers(): Promise<User[]>`.
  - `createThrottle({max=5, janelaMs=15*60*1000, agora=Date.now}): {registrarFalha(chave), bloqueado(chave): boolean, limpar(chave)}`.
  - Middlewares: `requireLogin` (redireciona a `/login`; se `trocar_senha`, a `/trocar-senha`), `requireAdmin` (403).
  - `createApp({pool, exporter?}): express.Application` com sessão em MySQL, cookie `httpOnly`/`secure`/`sameSite=lax`, expiração `config.sessionHours`.
  - Rotas: `GET/POST /login`, `POST /logout`, `GET/POST /trocar-senha`, `GET/POST /usuarios`, `POST /usuarios/:id/senha`, `POST /usuarios/:id/ativo` (as de usuários só administrador).
  - `scripts/create-admin.js <nome> <login>`: pede a senha pelo terminal, cria administrador.

- [ ] **Step 1: Write the failing tests:** `users.test.js` (criar → `verifyLogin` correto retorna usuário; senha errada → `null`; inativo → `null`; `login` duplicado rejeita; `hash` ≠ senha); `throttle.test.js` (5 falhas → `bloqueado` true; após `janelaMs` com `agora` simulado → false; `limpar` zera); `auth.test.js` com supertest (login certo → 302 e cookie; sem login em `/` → 302 `/login`; usuário com `trocar_senha` é levado a `/trocar-senha`; editor em `/usuarios` → 403; 6ª tentativa errada → bloqueio com mensagem).
- [ ] **Step 2: Run** `node --test tests/repos/users.test.js tests/auth tests/routes/auth.test.js` → Expected: FAIL.
- [ ] **Step 3:** Implementar os módulos acima; chave do throttle = `login + ip`; mensagem de login inválido genérica (não revela se o usuário existe).
- [ ] **Step 4: Run** os testes → Expected: PASS.
- [ ] **Step 5:** `scripts/create-admin.js` (verificação manual na Task 8, documentada em INSTALL.md).
- [ ] **Step 6: Commit** `git commit -am "feat: usuarios, login, perfis e bloqueio de tentativas"`

---

### Task 3: Blocos, edições, versão otimista e histórico

**Files:**
- Create: `src/domain/blocks.js`, `src/domain/diff.js`, `src/repos/editions.js`, `src/repos/history.js`
- Test: `tests/domain/blocks.test.js`, `tests/domain/diff.test.js`, `tests/repos/editions.test.js`

**Interfaces:**
- Consumes: `getPool`, `listUsers` (nome para mensagem de conflito).
- Produces:
  - `TIPOS = ['destaque','card','dica','texto']`; `validateBlock(tipo: string, dados: object): {ok: boolean, errors: string[], dados: object}` (campos exigidos: destaque→`etiqueta,titulo,texto,chamada`; card→`etiqueta,titulo,texto`; dica→`titulo,texto`; texto→`titulo,texto`; `titulo` obrigatório e não vazio; aplica `trim`; limite 2000 caracteres por campo).
  - `diffBlocks(antes: Bloco[], depois: Bloco[]): Array<{acao: 'bloco_criado'|'bloco_alterado'|'bloco_removido'|'bloco_reordenado', blocoId, titulo}>`.
  - `class ConflictError extends Error { por: string }`.
  - `nextNumber(): Promise<number>`, `createEdition({numero, mesAno, titulo, subtitulo}, userId): Promise<number>`, `getEdition(id): Promise<{edicao, blocos}|null>`, `listEditions(): Promise<Edicao[]>` (com nome do último editor), `saveEdition(id, {versao, campos, blocos}, userId): Promise<number>` (nova versão; transação; rejeita edição `publicada`; lança `ConflictError` se `versao` ≠ atual), `setStatus(id, status, userId)`.
  - `logHistory(edicaoId, usuarioId, acao, detalhe): Promise<void>`, `listHistory(edicaoId): Promise<Evento[]>` (mais recente primeiro, com nome do usuário).

- [ ] **Step 1: Write the failing tests:** `blocks.test.js` (card sem título → `ok:false`; destaque completo → `ok:true`; tipo desconhecido → erro; texto com 2001 caracteres → erro; espaços nas pontas removidos). `diff.test.js` (cria/altera/remove/reordena detectados). `editions.test.js` (`nextNumber` em base vazia = 1, depois = 2; salvar com versão atual incrementa; salvar com versão antiga lança `ConflictError` com `por` = nome do outro editor; salvar edição publicada lança erro; cada save grava eventos em `historico`).
- [ ] **Step 2: Run** `node --test tests/domain tests/repos/editions.test.js` → Expected: FAIL.
- [ ] **Step 3:** Implementar. Blocos são substituídos por completo a cada save (apaga e reinsere com `ordem` 0..n dentro da transação); `diffBlocks` casa por `id` quando existir, senão trata como criado.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: blocos, edicoes com versao otimista e historico"`

---

### Task 4: Renderizador HTML no padrão do modelo

**Files:**
- Create: `src/render/renderEdition.js`, `src/render/styles.js`, `src/render/assets/` (fonte `.woff2`, `logo-padrao.png` extraída do PDF modelo)
- Test: `tests/render/renderEdition.test.js`

**Interfaces:**
- Consumes: formato `{edicao, blocos}` da Task 3; `config.minScale` não é usado aqui.
- Produces: `renderEdition({edicao, blocos, settings, logo, mode, scale}): string` — `mode` `'a4'` (página 210×297 mm, `overflow:hidden`) ou `'strip'` (largura 1080 px, altura livre); `scale` número (1 = 100%) aplicado por variável CSS `--escala` a fontes e espaçamentos; `settings` = `{emailTi, rodape, subtitulo...}`; `logo` = `{buffer, mime}`; cada bloco tem classe `bloco-<tipo>` e o corpo tem `data-conteudo` no elemento cuja altura o exportador mede (`#conteudo`).
- Regras: todo texto passa por escape HTML; `\n` vira `<br>`; cards consecutivos agrupados num `.grade-cards` de 2 colunas, último ímpar com `grid-column: 1 / -1`; linha de edição `TECNOLOGIA DA INFORMAÇÃO · EDIÇÃO 001 · OUTUBRO/2026` (número com 3 dígitos); `overflow-wrap: anywhere` nos textos; edição sem blocos mostra a mensagem "Edição vazia" só quando `mode` é preview (`preview: true`), nunca no PDF.

- [ ] **Step 1: Write the failing tests:** (a) edição com título `<script>alert(1)</script>` → HTML contém `&lt;script&gt;` e não contém `<script>alert`; (b) 3 cards seguidos → um `.grade-cards` com 3 `.bloco-card` e o último com classe `ultimo-impar`; (c) número 1 e mês `2026-10` → contém `EDIÇÃO 001 · OUTUBRO/2026`; (d) sem blocos → contém cabeçalho e rodapé (`TI SENAR-RS`, e-mail), não contém "Edição vazia" sem `preview`; (e) `scale: 0.8` → contém `--escala:0.8`; (f) `\n` no texto vira `<br>`.
- [ ] **Step 2: Run** `node --test tests/render` → Expected: FAIL.
- [ ] **Step 3:** Implementar `renderEdition` e `styles.js` reproduzindo o PDF modelo (cabeçalho verde escuro com barras, "SENAR" grande, logo à direita, card de destaque branco com borda, etiquetas em verde claro, faixa de dica verde com ponto amarelo, rodapé com linha). Paleta como variáveis `:root`.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Verificação visual (manual):** gerar o HTML com os dados do modelo (destaque Fluig, cards CFPR e REDE, dica de segurança), abrir no navegador ao lado do PDF modelo; ajustar CSS até ficar visualmente equivalente.
- [ ] **Step 6: Commit** `git commit -am "feat: renderizador HTML do comunicado"`

---

### Task 5: Redução automática e exportador (PDF e PNGs)

**Files:**
- Create: `src/export/fit.js`, `src/export/exporter.js`
- Test: `tests/export/fit.test.js`, `tests/export/exporter.test.js`

**Interfaces:**
- Consumes: `renderEdition` (Task 4).
- Produces:
  - `pickScale(medirMm: (scale: number) => Promise<number>, {piso=0.75, passo=0.05, alturaMm=297}): Promise<{scale: number, estouro: boolean, faltaMm: number}>` — testa 1.0, 0.95, … até `piso`; devolve o primeiro que cabe; senão `{scale: piso, estouro: true, faltaMm: altura(piso) - alturaMm}`.
  - `createExporter({renderHtml, piso}): {fit(input), pdf(input), pngEmail(input), pngWhatsapp(input), close()}` onde `input = {edicao, blocos, settings, logo}`; `fit` → `{scale, estouro, faltaMm}`; `pdf` → `Buffer` (A4, `printBackground`, 1 página); `pngEmail` → `Buffer` PNG 1240×1754; `pngWhatsapp` → `Buffer` PNG largura 1080, altura do conteúdo, `scale` 1. Uma fila serial (promessas encadeadas) garante um trabalho por vez; navegador Puppeteer único, reaberto se cair.
  - `class ExportUnavailableError extends Error` quando o Chromium não abre.

- [ ] **Step 1: Write the failing tests:** `fit.test.js` com `medir` simulado — cabe a 100% → `{scale:1, estouro:false}`; cabe só a 0.85 → `scale 0.85`; não cabe nem a 0.75 → `estouro:true`, `faltaMm` positivo; piso customizado 0.6 é respeitado; passo de 5%. `exporter.test.js` (usa Chromium real): `pdf` retorna Buffer que começa com `%PDF` e tem 1 página; `pngEmail` tem 1240×1754 (ler cabeçalho IHDR); `pngWhatsapp` tem largura 1080; duas chamadas simultâneas terminam ambas e em ordem; edição com 30 cards longos → `fit` retorna `estouro:true`; com Chromium indisponível (caminho inválido) → `ExportUnavailableError`.
- [ ] **Step 2: Run** `node --test tests/export` → Expected: FAIL.
- [ ] **Step 3:** Implementar `fit.js` (puro) e `exporter.js`; a altura é medida via `page.$eval('#conteudo', el => el.scrollHeight)` convertida de px para mm (96 dpi); PNG A4 com `deviceScaleFactor` 150/96.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: reducao automatica e exportador PDF/PNG"`

---

### Task 6: Publicação, arquivos no banco, configurações e rotas de exportação

**Files:**
- Create: `src/repos/files.js`, `src/repos/settings.js`, `src/routes/exports.js`, `src/routes/editions.js`, `src/routes/settings.js`
- Test: `tests/repos/files.test.js`, `tests/routes/editions.test.js`, `tests/routes/exports.test.js`

**Interfaces:**
- Consumes: `saveEdition`, `setStatus`, `logHistory`, `createExporter`, `requireLogin`, `requireAdmin`.
- Produces:
  - `saveFiles(edicaoId, userId, {pdf, pngEmail, pngWhatsapp}): Promise<void>` (substitui existentes, transação), `getFile(edicaoId, tipo): Promise<{conteudo: Buffer, gerado_em}|null>`, `deleteFiles(edicaoId): Promise<void>`.
  - `getSettings(): Promise<{emailTi, rodape, pisoReducao, cores...}>` com padrões (`informatica@senar-rs.com.br`, `TI SENAR-RS`, `0.75`), `setSettings(obj)`, `getLogo()/setLogo(buffer, mime)`.
  - Rotas: `POST /edicoes` (cria), `GET /edicoes/:id/preview` (HTML com `preview:true` e escala do `fit`; resposta inclui cabeçalho `X-Ajuste: 100|88|limite`), `PUT /edicoes/:id` (salva; 409 com mensagem de conflito), `POST /edicoes/:id/publicar` (gera os 3 arquivos, grava, status `publicada`; se `estouro` e sem `confirmar=1` → 409 "conteúdo será cortado"), `POST /edicoes/:id/reabrir` (status `rascunho`, `deleteFiles`), `GET /edicoes/:id/download/:tipo` (`pdf|png-email|png-whatsapp`: se publicada vem do banco, senão gera na hora; A4 estourado exige `confirmar=1`; registra `baixou` no histórico; `ExportUnavailableError` → 503 com mensagem), `GET/POST /configuracoes` e upload de logo (administrador).

- [ ] **Step 1: Write the failing tests:** `files.test.js` (salvar e ler Buffer idêntico byte a byte; salvar de novo substitui; `deleteFiles` limpa). `editions.test.js`/`exports.test.js` com `exporter` falso: `PUT` com versão antiga → 409 e texto "foi alterada por"; `PUT` em publicada → 409/403; `publicar` grava 3 arquivos e muda status; `publicar` com `estouro` sem `confirmar` → 409; `reabrir` remove arquivos; download de publicada devolve exatamente os bytes guardados sem chamar o exportador; Chromium indisponível → 503; configurações só administrador (editor → 403); `publicar`/`reabrir`/`baixou` aparecem no histórico.
- [ ] **Step 2: Run** `node --test tests/repos/files.test.js tests/routes` → Expected: FAIL.
- [ ] **Step 3:** Implementar repositórios e rotas; `Content-Type` e `Content-Disposition` corretos (`comunicado-001.pdf`, `comunicado-001-email.png`, `comunicado-001-whatsapp.png`).
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: publicacao com arquivos no MySQL, downloads e configuracoes"`

---

### Task 7: Interface (telas e editor com preview ao vivo)

**Files:**
- Create: `src/views/login.ejs`, `lista.ejs`, `editor.ejs`, `historico.ejs`, `usuarios.ejs`, `configuracoes.ejs`, `trocar-senha.ejs`, `src/public/editor.js`, `src/public/app.css`
- Modify: `src/routes/editions.js` (rotas de tela), `src/app.js` (arquivos estáticos, `res.locals.usuario`)
- Test: `tests/routes/views.test.js`

**Interfaces:**
- Consumes: todas as rotas das Tasks 2 e 6.
- Produces: `GET /` (lista), `GET /edicoes/nova`, `GET /edicoes/:id` (editor), `GET /edicoes/:id/historico`, `GET /usuarios`, `GET /configuracoes`. `editor.js` expõe: adicionar/remover/reordenar bloco (botões subir/descer), envio `PUT` com `versao`, recarrega o preview (iframe `srcdoc` ou `src` de `/preview`) com debounce de 600 ms, mostra o indicador de ajuste lendo `X-Ajuste`, trata 409 exibindo a mensagem de conflito, e confirma antes de baixar A4 estourado (`confirmar=1`).

- [ ] **Step 1: Write the failing test** `views.test.js`: `GET /` logado mostra "Nova edição" e a edição criada com o último editor; `GET /edicoes/:id` contém os botões "Baixar PDF", "Baixar PNG (e-mail)", "Baixar imagem (WhatsApp)", "Publicar"; edição publicada renderiza o editor travado (campos `disabled`) e botão "Reabrir"; `GET /edicoes/:id/historico` lista "Ana alterou…"; `GET /usuarios` como editor → 403; todas as páginas escapam nomes de usuário com HTML.
- [ ] **Step 2: Run** `node --test tests/routes/views.test.js` → Expected: FAIL.
- [ ] **Step 3:** Implementar views, CSS e `editor.js`. Layout do editor em duas colunas (blocos à esquerda, preview A4 à direita); no celular, preview abaixo.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Verificação manual** no navegador (`npm start` com banco local): criar edição com os dados do PDF modelo, adicionar 4 blocos, reordenar, ver o indicador mudar ao encher a página, baixar os 3 arquivos, publicar, reabrir, abrir o histórico, abrir a mesma edição em duas abas e provocar o conflito.
- [ ] **Step 6: Commit** `git commit -am "feat: interface de edicoes, editor com preview, historico e usuarios"`

---

### Task 8: Publicação no servidor (deploy, backup, documentação)

**Files:**
- Create: `deploy/boletim.service`, `deploy/boletim.nginx.conf`, `deploy/backup.sh`, `deploy/INSTALL.md`, `src/server.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Consumes: `createApp`, `migrate`, `getPool`, `createExporter`.
- Produces: `src/server.js` (roda `migrate` na subida, abre o exportador, escuta `config.port`, encerra Chromium e pool em `SIGTERM`); `GET /saude` retorna `200 {ok:true}` com teste de ping no banco (usado por monitoramento).
- `INSTALL.md` cobre: pacotes Ubuntu (Node 20, dependências do Chromium), criar banco `boletim` e usuário dedicado, `max_allowed_packet=16M`, `.env`, `npm ci --omit=dev`, criar primeiro administrador (`node scripts/create-admin.js`), instalar o serviço systemd, site nginx com HTTPS e proxy para a porta interna, cron do backup, procedimento de atualização (copiar, `npm ci`, reiniciar; a migração roda sozinha) e restauração de backup.
- `backup.sh`: `mysqldump --single-transaction boletim | gzip` em `/var/backups/boletim/boletim-AAAAMMDD.sql.gz`, apaga arquivos com mais de 28 dias.

- [ ] **Step 1: Write the failing test** `server.test.js`: `GET /saude` → 200 `{ok:true}` com banco no ar; com pool quebrado → 503.
- [ ] **Step 2: Run** `node --test tests/server.test.js` → Expected: FAIL.
- [ ] **Step 3:** Implementar `server.js` e a rota `/saude`; escrever os arquivos de `deploy/` (unit com `Restart=always`, `User=boletim`, `EnvironmentFile`; nginx com `client_max_body_size 5m`, cabeçalhos de proxy e `X-Forwarded-Proto` — necessário para o cookie `secure` atrás do proxy, com `app.set('trust proxy', 1)`).
- [ ] **Step 4: Run** `npm test` (suíte completa) → Expected: tudo PASS.
- [ ] **Step 5: Verificação de ponta a ponta** numa VM/servidor Ubuntu seguindo só o `INSTALL.md`: login, criar edição, publicar, baixar os 3 arquivos, reiniciar o serviço e confirmar que os dados continuam, rodar `backup.sh` e restaurar num banco de teste.
- [ ] **Step 6: Commit** `git commit -am "feat: servidor, deploy, backup e guia de instalacao"`

---

## Self-Review

- **Cobertura da spec:** §4 telas → Tasks 2, 6, 7; §5 blocos → Tasks 3, 4; §6 redução e saídas → Tasks 4, 5, 6; §7 login/perfis/histórico/concorrência → Tasks 2, 3, 6; §8 dados → Task 1; §9 deploy e backup → Task 8; §10 erros e testes → distribuídos (503 do Chromium nas Tasks 5 e 6).
- **Consistência de nomes:** `saveEdition`, `ConflictError`, `pickScale`, `createExporter`, `renderEdition`, `saveFiles/getFile/deleteFiles` aparecem com a mesma assinatura onde são produzidos e consumidos.
- **Review Focus coberto:** (1) escape → Task 4 teste (a); (2) edição vazia → Task 4 teste (d) e Task 5; (3) texto gigante → Task 4 CSS + Task 5 teste de estouro; (4) cards ímpares → Task 4 teste (b); (5) concorrência/Chromium → Task 5 e Task 6.
- **Proporção:** o plano define assinaturas, testes e valores da spec; os corpos das funções ficam com quem implementa.
