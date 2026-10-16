# Relatório: Comunicado Semanal em `/boletim_ti/` (BASE_PATH)

Branch: `feat/base-path` (a partir de `main` 2f09564) · Último commit: `05fa55d` · Nada foi aplicado em produção.

## 1. Resultado
- O sistema funciona **na raiz** (sem `BASE_PATH`) e **em `/boletim_ti`** (`BASE_PATH=/boletim_ti`): login, logout, troca obrigatória de senha, edições, salvamento automático, pré-visualização, publicação, downloads (PDF, PNG A4, PNG WhatsApp), usuários, configurações e logo.
- Testes: **301 passando, 0 falhando** (eram 201). `npm audit` e `npm audit --omit=dev`: **0 vulnerabilidades** (eram 9, sem `--force`).
- Verificação manual com o Edge sob `/boletim_ti`: as 38 requisições de uma sessão completa ficaram todas dentro do prefixo; um teste rápido no modo raiz também passou.

## 2. O que mudou
**Aplicação (`BASE_PATH`)**
- `src/base-path.js` (novo): normaliza e valida o valor (rejeita `//`, `..`, `http://`, `?`, `#`, `\`, `%`, espaços e primeiro segmento que colida com rotas ou arquivos da aplicação), monta URLs (`makeUrl`) e calcula o caminho relativo.
- `src/config.js`, `src/bootstrap.js`, `src/app.js`: o `BASE_PATH` entra pela configuração; todas as rotas ficam num roteador montado no prefixo; fora do prefixo tudo responde 404 (sem sessão e sem cookie), exceto `/saude` (na raiz e sob o prefixo); cookie `boletim.sid` com `Path` do prefixo, `HttpOnly`, `SameSite=Lax` e `Secure` conforme `COOKIE_SECURE`; roteamento sensível a maiúsculas.
- `src/auth/middleware.js`, `src/routes/auth.js`, `src/routes/users.js`: redirecionamentos só para destinos fixos internos; `wantsJson` usa o caminho relativo ao prefixo.
- `src/views/**` (todos os templates e partials): todo `href`, `action` e `src` interno passa por `u()`; `<meta name="base-path">` no cabeçalho.
- `src/public/api.js`, `editor.js`, `nova.js`, `configuracoes.js`: `Api.url`/`urlComBase` em todo `fetch`, navegação e imagem; sem substituição cega.
- `scripts/dev-server.js`: repassa `BASE_PATH`.

**Dependências:** `package.json`/`package-lock.json` (`puppeteer-core` 25.14.0, `overrides` do `mysql2`, `engines.node >=22.12.0`) e `docs/seguranca-dependencias.md` (os 9 alertas, alcance em produção, como reproduzir).

**Operação:** `Dockerfile`, `.dockerignore`, `deploy/apache/boletim_ti.conf`, `deploy/apache/README.md`, `deploy/docker/README.md`, `deploy/ATUALIZACAO.md` (atualização e rollback), ajustes em `README.md`, `.env.example`, `.gitattributes`, `deploy/boletim.env.example` e `deploy/INSTALL.md` (Node 22.12).

**Testes novos:** `tests/base-path.test.js`, `tests/routes/base-path-backend.test.js`, `tests/routes/templates-base-path.test.js`, `tests/routes/flows-base-path.test.js`, `tests/public/api-url.test.js`, `tests/guard-paths.test.js` (varredura de caminhos fixos), `tests/deploy-files.test.js`; alterados: `tests/helpers/routes.js`, `tests/routes/publish-real.test.js`. Os testes de rotas rodam nos **dois modos**.

**Documentos de projeto:** spec e plano em `docs/superpowers/` e três capturas em `docs/superpowers/plans/assets/base-path-*.png`.

Total: 51 arquivos (20 novos, 31 alterados) em 9 commits.

## 3. Decisões tomadas
- O Apache **mantém o prefixo** (`ProxyPass /boletim_ti/ http://127.0.0.1:3100/boletim_ti/`); a aplicação serve tudo sob o prefixo.
- A exceção do redirecionamento HTTP→HTTPS é uma `RewriteCond %{REQUEST_URI} !^/boletim_ti(/|$)` na regra global existente (o `mod_rewrite` roda antes do `mod_proxy`).
- Faixa de rede autorizada: marcador `FAIXA_AUTORIZADA_AQUI`, que faz o `apachectl configtest` falhar de propósito até ser preenchido.
- O nome do cookie mudou de `sid` para `boletim.sid`: todos precisam entrar de novo uma vez.
- Dockerfile reconstruído (`node:22-bookworm-slim`, Chromium do Debian), nova tag `boletim-senar:1.1`; a `1.0` fica para rollback.

## 4. O que ainda precisa ser feito por quem opera
1. Preencher `FAIXA_AUTORIZADA_AQUI` com a(s) faixa(s) de rede autorizada(s).
2. Validar **no servidor**: `docker build`, `apachectl configtest`, a matriz de `curl` do `deploy/apache/README.md` e o teste de exportação dentro do contêiner (`node scripts/smoke-export.js`), que é o portão antes de trocar o tráfego.
3. Passar para HTTPS assim que possível (guia em `deploy/apache/README.md`, seção da fase HTTPS): remover a exceção do HTTP junto com `COOKIE_SECURE=true`.

## 5. Limitações conhecidas
- Nesta máquina (Windows) **não há Apache nem Docker**: a configuração do Apache, o Dockerfile e os guias foram revisados por leitura, não executados. O `puppeteer-core` 25 com o Chromium do Debian também não foi testado (só com o Edge).
- Testes de banco rodaram em MariaDB 11.8; a produção usa MariaDB 10.5.
- Ponto de atenção no rollback (`deploy/ATUALIZACAO.md`): se o passo 3 falhar **antes** do `docker rename` e o nome novo for igual ao do contêiner antigo (padrão `boletim`), o comando de rollback `docker stop/rm "$NOVO"` removeria o contêiner `1.0`. Antes de rodar o rollback, confira a imagem com `docker ps -a --format '{{.Names}} {{.Image}}'`.
- Itens menores adiados estão no ledger interno da revisão (rotas internas sem distinção de maiúsculas, exemplos `docker exec boletim` fixos, entre outros).
