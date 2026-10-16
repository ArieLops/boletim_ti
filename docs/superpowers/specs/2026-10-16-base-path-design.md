# Comunicado Semanal em subdiretório (`/boletim_ti/`) — Design

Data: 2026-10-16 · Status: aprovado pelo usuário em conversa (plano técnico) · Branch: `feat/base-path`

## 1. Objetivo
O sistema (Node 22, Express 5, EJS, MariaDB 10.5, Docker, Apache2 como proxy reverso) hoje funciona na raiz (`http://127.0.0.1:3100/`). Deve funcionar integralmente em `http://192.168.10.161/boletim_ti/`, num servidor que hospeda outros sistemas, sem quebrá-los nem interferir neles. Sem `BASE_PATH` continua funcionando na raiz.

## 2. Restrições do usuário (binding)
- Variável `BASE_PATH` (ex.: `/boletim_ti`); ausente = raiz; normalizada; sem valores inseguros/URL externa; construção de URLs centralizada; contratos das APIs preservados.
- Corrigir todos os pontos: redirects, links, formulários, JS, APIs, estáticos, downloads, logo, mensagens de erro.
- Autenticação: login/logout/troca obrigatória de senha em `/boletim_ti/...`; cookies com escopo adequado; CSRF preservado; redirects não escapam do prefixo; nenhuma rota exposta fora do prefixo; `COOKIE_SECURE=false` só enquanto não houver HTTPS, sem reduzir outras proteções.
- Exportações (PDF A4, PNG A4, PNG WhatsApp, pré-visualização, download de publicados, ajuste de escala, arquivos no MariaDB) não podem regredir. Chromium da imagem: `/usr/bin/chromium`.
- Apache: entregar arquivo de configuração proposto + comandos de aplicar/validar/reverter; NÃO alterar o servidor; exceção do redirect HTTP→HTTPS só para `/boletim_ti/`; acesso HTTP restrito à rede interna (faixa a ser preenchida pelo usuário); atenção à ordem RewriteRule/ProxyPass.
- Docker: imagem existente `boletim-senar:1.0` (porta interna 3000, publicada em `127.0.0.1:3100`, MariaDB em `172.17.0.1:3306`, usuário sem privilégios, restart automático). Não existe Dockerfile no repositório: reconstruir (Node ≥ 22.12, Chromium em `/usr/bin/chromium`). Sem segredos no repositório/imagem. Não mexer em outros contêineres/serviços/bancos.
- Testes automatizados nos dois modos (raiz e `/boletim_ti`), mantendo os 201 anteriores.
- Segurança de dependências: analisar os 9 alertas do `npm audit`, corrigir com atualização compatível, **sem `npm audit fix --force`**.
- Entregáveis: código, testes, exemplo Apache, ajustes Docker, instruções de atualização e rollback, relatório de arquivos alterados e resultados de testes. Commit em branch, preparado para a `main`, sem publicar em produção, sem recriar o projeto, sem tocar no banco.

## 3. Arquitetura
### 3.1 Módulo `src/base-path.js`
- `normalizeBasePath(raw)`: `undefined`, `''` ou `'/'` → `''` (modo raiz). Caso contrário remove espaços nas pontas e barras finais, exige o formato `^/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$` (rejeita `//`, `..`, `.` isolado como segmento, esquema/host, `?`, `#`, `\`, `%`, espaços e qualquer outro caractere); inválido lança `Error` em português com o valor recebido.
- `makeUrl(base)` → `u(path)`: exige `path` começando com `/` (e não `//`), devolve `base + path`; `u('/')` → `base + '/'` (ou `/`). Única função que monta URLs internas.
- `relativePath(base, originalUrl)`: devolve o caminho sem o prefixo (para `wantsJson`).
- `config.basePath = normalizeBasePath(env.BASE_PATH)` (valor inválido derruba a subida com mensagem clara).

### 3.2 Montagem no Express (`src/app.js`)
- `createApp({..., basePath})` (default: da config quando as demais opções vêm da config; `''` nos testes que não passam).
- Um `Router` raiz agrupa: middleware que define `res.locals.u`, `res.locals.basePath`; estáticos; parsers; sessão; CSRF; `loadUser`; todas as rotas atuais (auth, users, editions, exports, settings, screens). Esse router é montado em `base || '/'`.
- `/saude` continua na raiz (healthcheck do Docker em `127.0.0.1:3100/saude`) e também em `base + '/saude'`. Qualquer outro caminho fora do prefixo → 404 texto simples (sem sessão, sem detalhes). Modo raiz: comportamento atual.
- Sessão: cookie `boletim.sid` (evita colisão com `sid`/`PHPSESSID` de outras aplicações no mesmo host), `Path = base || '/'`, `HttpOnly`, `SameSite=Lax`, `Secure` conforme `COOKIE_SECURE`, `rolling` como hoje.
- `wantsJson` compara o caminho relativo ao prefixo (`/api/...`) e continua por `Accept`/`Content-Type`.
- Todo `res.redirect` usa `u()` com destinos constantes (nunca valor vindo do usuário → sem open redirect).

### 3.3 Templates e navegador
- Todos os `href`, `action`, `src` internos nos `.ejs` (inclusive partials, `foot.ejs`, logo em `configuracoes.ejs`, link de histórico) passam por `u()`.
- `head.ejs` publica `<meta name="base-path" content="<%= basePath %>">`.
- `src/public/api.js` expõe `Api.url(path)` (prefixa com o valor do meta) e `Api.json` passa a prefixar automaticamente (chamadores passam caminhos relativos à aplicação, ex.: `'/edicoes/1'`); `fetch` diretos e `location.assign` em `editor.js`, `nova.js`, `configuracoes.js` usam `Api.url`. 401 → `Api.url('/login')`. Sem substituição global de strings: revisão ponto a ponto.
- Guarda de regressão: teste que varre `src/views/**/*.ejs` e `src/public/*.js` procurando caminhos internos absolutos fora do helper.

### 3.4 Apache (arquivos de apoio, sem aplicar)
- Repasse **sem retirar o prefixo**: `ProxyPass /boletim_ti/ http://127.0.0.1:3100/boletim_ti/`, `ProxyPassReverse` idem; `ProxyPreserveHost On`; `RequestHeader set X-Forwarded-Proto` conforme o esquema; redirect `/boletim_ti` → `/boletim_ti/`.
- Exceção no redirect global HTTP→HTTPS: `RewriteCond %{REQUEST_URI} !^/boletim_ti(/|$)` na regra existente (o `mod_rewrite` do contexto do servidor roda antes do `mod_proxy`; por isso a exceção precisa estar na própria regra).
- Restrição de rede: `<Location /boletim_ti/>` com `Require ip <FAIXA_AUTORIZADA>` (marcador explícito a preencher; enquanto não preenchido o `apachectl configtest` falha de propósito, impedindo aplicar sem definir a faixa).
- Entregue como `deploy/apache/boletim_ti.conf` (snippet para `Include` nos VirtualHosts :80 e :443) + `deploy/apache/README.md` (aplicar, validar com `apachectl configtest` e matriz de `curl`, reverter) — nada é aplicado automaticamente.

### 3.5 Docker
- `Dockerfile` (reconstrução): `node:22-bookworm-slim`, `chromium` + fontes (`fonts-noto-color-emoji`, `fonts-noto-core`, `fonts-liberation`) via apt, `npm ci --omit=dev`, `USER node`, `ENV CHROMIUM_PATH=/usr/bin/chromium HOST=0.0.0.0 PORT=3000 NODE_ENV=production`, `HEALTHCHECK` em `/saude`, `CMD node src/server.js`; `.dockerignore`. Nova tag `boletim-senar:1.1` (a `1.0` permanece para rollback).
- `deploy/docker/README.md`: build, `docker run` de exemplo (`--env-file` fora do repositório, `-e BASE_PATH=/boletim_ti`, `COOKIE_SECURE=false`, `-p 127.0.0.1:3100:3000`, `--restart unless-stopped`, `CHROMIUM_NO_SANDBOX=1` quando o sandbox do Chromium não estiver disponível ao usuário sem privilégios), atualização e rollback.
- Não testável nesta máquina (sem Docker) — validação no servidor.

### 3.6 Segurança de dependências
Alertas (8 altos + 1 moderado) são transitivos de duas diretas: `puppeteer-core@24` (cadeia `@puppeteer/browsers` → `extract-zip`, `proxy-agent` → `pac-proxy-agent` → `get-uri` → `basic-ftp`) e `express-mysql-session@3.0.3` (→ `mysql2@3.10.2` aninhado). Nenhum desses caminhos de código é usado (não baixamos navegador, não usamos proxy PAC/FTP; o store usa o pool do `mysql2` direto, já na 3.24.6). Correções: `puppeteer-core@^25.14.0` (exige Node ≥ 22.12 → `engines` passa a `>=22.12`) e `overrides` do npm forçando o `mysql2` corrigido no `express-mysql-session` (em vez do `--force`, que rebaixaria para 2.1.8). Meta: `npm audit` sem alertas; se restar algo, documentar o motivo.

## 4. Testes
- Unitários: `normalizeBasePath` (tabela válidos/inválidos), `makeUrl`, `relativePath`, `Api.url`.
- Matriz raiz × `/boletim_ti` (supertest, banco de teste próprio): páginas `/`, `/login`, `/edicoes`, `/usuarios`, `/api/configuracoes`; login/logout/troca obrigatória de senha; cookie (nome, `Path`, flags); CSRF; redirects (Location sempre dentro do prefixo); links/forms/scripts dos templates (varredura do HTML); estáticos; fluxo editor (criar, salvar com `saveToken`, pré-visualização, publicar, download, reabrir); logo; usuários; 404 fora do prefixo; `/saude` na raiz. Exportador falso na maioria; uma publicação com exportador real (Edge) em modo prefixado.
- Os 201 testes existentes continuam passando (modo raiz).

## 5. Fora de escopo
HTTPS no Apache (só previsto), mudanças em outros VirtualHosts/serviços, banco de dados, itens adiados anteriormente (bloco incompleto, ruído de histórico etc.).

## 6. Riscos e pontos não verificáveis aqui
Sem Apache e sem Docker neste computador: `deploy/apache/*` e `Dockerfile` são validados no servidor com os comandos entregues. A troca do nome do cookie desloga todos uma única vez. Faixa de rede para `Require ip` é preenchida pelo usuário.
