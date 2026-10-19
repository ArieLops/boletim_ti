# Link público do comunicado — Design

Data: 2026-10-19 · Status: aprovado pelo usuário em conversa · Branch: `feat/link-publico` (a partir de `main` ebbff78)

## 1. Objetivo
Ao **Publicar** uma edição, o sistema passa a ter um **link público** que qualquer pessoa dentro do SENAR com o endereço consiga abrir **sem login**. O link é fixo por edição: enquanto a edição está reaberta ele mostra "em revisão"; ao publicar de novo, o mesmo link volta com o conteúdo corrigido.

## 2. Decisões do usuário
- A pessoa vê uma **página web** com o comunicado legível no celular e no computador (mesmo visual do modelo) e **botões de download** (PDF, PNG para e-mail, PNG para WhatsApp).
- **Mesmo link sempre**: reabrir não o apaga; republicar o reativa.
- Sem expiração, sem senha no link, sem contador de acessos, sem botão "gerar novo link" (fora de escopo; podem vir depois).

## 3. Arquitetura
### 3.1 Banco
- Migração `002_link_publico.sql` (aditiva, idempotente, portável MariaDB/MySQL 8): coluna `edicoes.token_publico VARCHAR(32) NULL` e índice único `uq_edicoes_token_publico`. Como `ADD COLUMN IF NOT EXISTS` não existe no MySQL 8, a migração usa `information_schema` + `PREPARE/EXECUTE` (o separador de comandos de `migrate.js` quebra por `;` no fim da linha; os comandos devem respeitar isso).
- A mudança é só de acréscimo: a imagem anterior (1.0) continua funcionando com o banco já migrado (rollback seguro). O guia `deploy/ATUALIZACAO.md` deixa de afirmar "schema idêntico".

### 3.2 Código do link
- `token_publico` = 16 bytes aleatórios (`crypto.randomBytes(16).toString('base64url')`, 22 caracteres `[A-Za-z0-9_-]`).
- Gerado **uma vez**, na primeira publicação, dentro da transação de `publicarTx` (`token_publico = COALESCE(token_publico, ?)`); republicar e reabrir não o alteram. A primeira geração grava o evento de histórico `link_publico_criado`.
- A resposta de `POST /edicoes/:id/publicar` passa a incluir `{status:'publicada', token}` (campo novo; o resto do contrato não muda). As páginas do editor recebem o token (se existir) para mostrar o link.

### 3.3 Rotas públicas (sem sessão)
Montadas num Router próprio **antes** do Router com sessão/CSRF/`loadUser`, sob o prefixo (`base + '/p/…'`):
- `GET /p/:token` — página pública.
  - Token com formato inválido ou inexistente → 404 genérico (mesma resposta nos dois casos).
  - Edição **publicada** → 200 com o comunicado.
  - Edição com token mas **em rascunho** (reaberta) → 200 com a mensagem "Este comunicado está em revisão. Volte em instantes." (nada do rascunho aparece).
- `GET /p/:token/baixar/:tipo` (`pdf` | `png-email` | `png-whatsapp`) — bytes de `arquivos_publicados` (os mesmos publicados), `Content-Disposition: attachment` com o nome `comunicado-NNN…`; só para edição publicada; token/tipo inválidos ou sem arquivo → 404.
- **Sem sessão e sem cookie** nessas rotas (não criam linha na tabela de sessões). A rota não expõe editor, outras edições, usuários ou configurações.
- Cabeçalhos: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` e uma `Content-Security-Policy` restritiva (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`).
- **Limite de tentativas por IP** (`createThrottle`, memória): cada requisição com token inválido/inexistente conta como falha; ao atingir o limite (padrão 30 em 10 min) responde 429 sem consultar o banco. Falhas e bloqueio só dizem respeito a `/p/…`.
- `normalizeBasePath` passa a rejeitar `/p` como primeiro segmento (colisão com a nova rota).

### 3.4 Página pública
- Novo modo `web` em `renderEdition` (HTML responsivo e fluido, largura máxima ~960 px, sem altura fixa, cards em 1 coluna em tela estreita) e parâmetro `barraHtml` (string de confiança, montada no servidor) exibido no topo apenas nesse modo, com os três botões de download (links `u('/p/<token>/baixar/<tipo>')`; o token só contém `[A-Za-z0-9_-]`).
- Todo texto de usuário continua escapado. A página é um documento HTML completo (não usa o layout com navegação do sistema) e funciona sem JavaScript.
- Página "em revisão" e 404 públicos: HTML simples, mesma identidade visual, sem links para o sistema.

### 3.5 Editor
- Faixa **"Link público"** no editor (somente quando já existe token): campo somente leitura com o endereço completo (`location.origin + Api.url('/p/' + token)`) e botão **Copiar link** (`navigator.clipboard` com alternativa por seleção do campo). Com a edição em rascunho e token existente, a faixa diz "em revisão: o link volta a funcionar ao publicar".
- Ao publicar com sucesso, a faixa aparece/atualiza com o token da resposta, sem recarregar.
- O histórico mostra o evento `link_publico_criado` com rótulo em português.

## 4. Segurança e limites conhecidos
- O link é uma **chave de acesso**: quem o tiver e alcançar o servidor, abre. "Dentro do SENAR" vem da restrição de rede do Apache (`Require ip`) já documentada; se o servidor sair da rede interna, os links passam a ser abertos a quem os tiver.
- Em HTTP o link e o conteúdo trafegam sem criptografia na rede interna (como o resto do sistema até o HTTPS).
- O token tem 128 bits; a adivinhação é inviável e ainda limitada por IP. O token fica em texto no banco (precisa ser exibido de novo no editor).

## 5. Testes
Unitários (token, validação de formato, throttle público); migração (idempotente: duas execuções, coluna e índice únicos presentes); repositório e publicação (token criado uma vez, mantido em republicação/reabertura, evento de histórico único); rotas públicas nos dois modos (raiz e `/boletim_ti`): página publicada, "em revisão", 404 igual para inexistente/inválido, downloads iguais aos arquivos do banco, ausência de `Set-Cookie` e de linha de sessão, cabeçalhos e CSP, limite de tentativas (429), XSS em título/textos, links da página com o prefixo; editor (faixa, `data-token`); `normalizeBasePath` rejeita `/p`; guard de caminhos continua passando; suíte existente (319) intacta.

## 6. Fora de escopo
Expiração, senha, contador/lista de acessos, regenerar link, QR code, compartilhamento por e-mail/WhatsApp pelo sistema.
