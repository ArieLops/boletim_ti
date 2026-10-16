# Comunicado Semanal SENAR-RS — Design

Data: 2026-10-16 · Status: aguardando revisão

## 1. Objetivo

Sistema web interno, hospedado em servidor da TI, onde a equipe de TI do SENAR-RS cadastra as notícias do **Comunicado Semanal**. A partir de cada edição o sistema gera:

1. **PDF A4** (1 página) para anexar em e-mail.
2. **PNG da página A4** para colar no corpo do e-mail.
3. **PNG em tira vertical** para WhatsApp.

O padrão visual é o do arquivo `Modelo_Comunicado_Semanal_SENAR_RS_Final.pdf`: cabeçalho verde escuro com logo, linha de edição ("TECNOLOGIA DA INFORMAÇÃO · EDIÇÃO 001 · OUTUBRO/2026"), destaque, cards com etiqueta, faixa de dica verde e rodapé (TI SENAR-RS + e-mail da TI).

## 2. Decisões e restrições

| Tema | Decisão |
|---|---|
| Uso | Equipe da TI, servidor interno compartilhado |
| Servidor | Ubuntu, nginx (Apache existente, não usado por este projeto) |
| Stack | Node.js 20+, Express, MySQL/MariaDB, Chromium headless (Puppeteer) |
| Login | Usuário e senha individuais; histórico de quem editou |
| Estrutura | Totalmente flexível: blocos livres, quantidade e ordem definidas pelo editor |
| Limite A4 | Redução automática de fontes/espaçamento até um piso (padrão 75%); acima disso, aviso |
| Armazenamento | Tudo no MySQL, inclusive PDF/PNGs publicados e logo (LONGBLOB) |
| Fora do escopo (v1) | Login AD/Microsoft 365, envio automático de e-mail/WhatsApp, agendamento |

## 3. Arquitetura

Uma aplicação, quatro partes:

- **Servidor web (Express):** rotas, sessão, telas, API.
- **Banco (MySQL):** usuários, edições, blocos, histórico, arquivos publicados, configurações.
- **Renderizador:** gera o HTML/CSS (210×297 mm) da edição. É a **única fonte visual**: pré-visualização, PDF e PNGs usam o mesmo HTML.
- **Exportador:** Chromium headless abre o HTML e produz PDF/PNG. Fila com um trabalho por vez.

## 4. Telas

1. **Login.**
2. **Lista de edições:** número, mês/ano, status (rascunho/publicada), último editor. Botão "Nova edição" sugere o próximo número.
3. **Editor da edição** (duas colunas):
   - Esquerda: dados da edição (número, mês/ano, título, subtítulo) e lista de blocos (adicionar, reordenar, editar, remover).
   - Direita: pré-visualização A4 ao vivo com indicador de ajuste ("100%", "reduzido a 88%", "passou do limite").
   - Topo: **Baixar PDF**, **Baixar PNG (e-mail)**, **Baixar imagem (WhatsApp)**, **Publicar**.
4. **Histórico da edição:** linha do tempo de alterações.
5. **Usuários** (administrador): criar, redefinir senha, desativar.
6. **Configurações** (administrador): logo, rodapé, e-mail da TI, piso de redução, cores.

## 5. Blocos

| Tipo | Campos |
|---|---|
| Destaque | etiqueta, título, texto, linha de chamada |
| Card | etiqueta, título, texto (cards consecutivos ficam em duas colunas) |
| Dica | título, texto (faixa verde) |
| Texto livre | título, parágrafo |

Cabeçalho (logo, "SENAR / RIO GRANDE DO SUL", "Comunicado semanal") e rodapé são fixos, editáveis em Configurações.

## 6. Geração de arquivos

**Redução automática (A4):** o Chromium mede a altura do conteúdo; se > 297 mm reduz fonte e espaçamentos em passos de 5% (100 → 95 → … → piso) e para no primeiro que cabe. Se nem no piso couber: pré-visualização mostra "passou do limite" e quanto falta cortar; exportar A4 exige confirmação ("conteúdo será cortado").

| Saída | Formato | Tamanho |
|---|---|---|
| PDF e-mail | PDF A4, texto selecionável | 1 página |
| PNG e-mail | PNG da página A4 | 1240×1754 px (150 dpi) |
| PNG WhatsApp | PNG em tira, sem redução | 1080 px de largura, altura conforme conteúdo; aviso se muito alta |

Detalhes: fonte sans-serif embutida no servidor (não depender das fontes do Ubuntu); cores como variáveis CSS extraídas do PDF modelo; fila serializada de exportação.

**Edições publicadas:** ao publicar, o sistema gera os três arquivos e os grava no MySQL (LONGBLOB) com data e autor. Ficam congelados; downloads posteriores vêm do banco. Reabrir uma edição invalida os arquivos guardados (são regenerados na próxima publicação).

## 7. Login, usuários e histórico

- Senhas com bcrypt; sessão por cookie seguro (`httpOnly`, `secure`, `sameSite`), expira por inatividade; bloqueio temporário após tentativas inválidas repetidas; HTTPS no nginx.
- Perfis: **editor** e **administrador**. Primeiro administrador criado por comando de instalação. Troca de senha obrigatória no primeiro acesso. Desativar conta preserva o histórico.
- Histórico: cada gravação registra usuário, data/hora e a mudança (bloco criado/alterado/removido/reordenado); publicar, reabrir e baixar também são registrados.
- Concorrência: controle otimista por versão; ao gravar sobre versão desatualizada, o sistema recusa com a mensagem "esta edição foi alterada por <usuário>, recarregue".
- Edição publicada fica travada até alguém reabrir.

## 8. Modelo de dados (resumo)

- `usuarios` (id, nome, login, senha_hash, perfil, ativo, trocar_senha)
- `edicoes` (id, numero, mes_ano, titulo, subtitulo, status, versao, criado_por, atualizado_por, timestamps)
- `blocos` (id, edicao_id, tipo, ordem, dados JSON)
- `historico` (id, edicao_id, usuario_id, acao, detalhe JSON, criado_em)
- `arquivos_publicados` (id, edicao_id, tipo [pdf|png_email|png_whatsapp], conteudo LONGBLOB, gerado_por, gerado_em)
- `configuracoes` (chave, valor) e `logo` (conteudo LONGBLOB, mime)
- Migrações versionadas por script.

## 9. Publicação no servidor

- Serviço **systemd** (`boletim.service`) em porta interna; **nginx** como proxy reverso com HTTPS para o domínio interno.
- Banco `boletim` e usuário MySQL dedicado (não root); `max_allowed_packet` ≥ 16 MB.
- Backup diário com `mysqldump` via cron, retenção de semanas (tudo está no banco).
- Entregáveis: código, unit systemd, site nginx, script de backup, `.env` de exemplo, `INSTALL.md`, comando de criação do primeiro administrador.
- Atualização: copiar versão, rodar migração, reiniciar serviço.

**Pedidos à TI:** Node.js 20+ e Chromium (~300 MB) com dependências; MySQL/MariaDB com usuário próprio; nome DNS interno e certificado HTTPS; permissão para criar o serviço systemd e o site nginx.

## 10. Erros e testes

- Erros de exportação (Chromium indisponível, banco fora) retornam mensagem clara ao usuário e ficam no log do serviço.
- Testes: unidade (redução automática, validação de blocos, permissões, controle de versão), integração (API + MySQL de teste), e verificação visual das saídas contra o PDF modelo.

## 11. Pontos em aberto

Nenhum bloqueante. Piso de redução (75%), tempo de expiração da sessão e política de retenção dos backups são valores iniciais, ajustáveis por configuração.
