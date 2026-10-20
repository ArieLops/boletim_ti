# Comunicado Semanal SENAR-RS

Sistema web interno para montar o Comunicado Semanal da TI do SENAR-RS: o usuário edita os blocos (destaque, cards, dica), vê a prévia e publica a edição, que gera o **PDF** (uma página A4), o **PNG para e-mail** (1240x1754) e o **PNG para WhatsApp** (também uma folha A4 inteira, 1080x1527). Node.js 22.12+ (mínimo exigido pelo puppeteer-core 25; ver [docs/seguranca-dependencias.md](docs/seguranca-dependencias.md)), Express 5, MySQL/MariaDB; a exportação usa Chromium headless (puppeteer-core).

Especificação: `docs/superpowers/specs/2026-10-16-comunicado-semanal-design.md`.

## Testes

Precisa de um MariaDB/MySQL de teste configurado em `.env.test` (`TEST_DB_*`) e de um Chrome/Edge instalado para os testes de exportação.

```bash
npm ci
npm test
```

## Desenvolvimento

```bash
npm run dev    # http://localhost:3100, banco descartável boletim_dev (veja scripts/dev-server.js)
```

## Produção

`npm start` executa `src/server.js` (lê variáveis de ambiente; modelos em `.env.example` e `deploy/boletim.env.example`). `GET /saude` responde `{"ok":true}` quando o banco está acessível.

Instalação passo a passo no Ubuntu (Node, Chromium, banco, systemd, nginx, backup): **[deploy/INSTALL.md](deploy/INSTALL.md)**. Para validar o Chromium no servidor: `node --env-file=/etc/boletim/boletim.env scripts/smoke-export.js /tmp/smoke`.

## Link público

Ao publicar uma edição pela primeira vez, o sistema gera um link público (`/p/<token>`, token aleatório de 22 caracteres) que mostra o comunicado e permite baixar PDF e imagens sem login. O editor exibe a faixa "Link público" com o endereço completo e o botão "Copiar link". O link é permanente por edição: ao reabrir, ele passa a mostrar o aviso "em revisão"; ao publicar de novo, volta a mostrar a edição, com o mesmo endereço. A criação do link fica registrada no histórico. O link é uma chave de acesso: quem o tiver e alcançar o servidor abre o comunicado e baixa os arquivos sem login. O limite "só dentro do SENAR" depende da restrição de rede (`Require ip` no Apache; no caminho alternativo do nginx não há restrição, então restrinja a rede lá). Requer a migração `002_link_publico.sql` (aplicada automaticamente na subida).

## Imagem nos blocos

Cada bloco pode ter uma imagem opcional (PNG, JPEG ou WebP), mostrada à direita do texto (35% da largura do cartão, altura máxima de 180 px, proporção mantida) no PDF, nas imagens, na prévia e na página pública. No editor, use "Imagem (opcional)" em cada bloco: o navegador reduz a imagem (lado maior de 1200 px) antes de enviar, mostra a miniatura e salva sozinho; "Remover imagem" tira do bloco. Trocar o tipo do bloco mantém a imagem. Limites: 2 MB por imagem e 30 imagens por edição; o tipo é validado pelo conteúdo do arquivo (SVG e GIF são recusados). Em edição publicada só aparece a miniatura. Requer a migração `003_imagens.sql` (aplicada automaticamente na subida). Atenção ao rollback para a imagem anterior: ela descarta a ligação bloco-imagem ao salvar uma edição (veja [deploy/ATUALIZACAO.md](deploy/ATUALIZACAO.md)).

## Rodar em subdiretório (BASE_PATH)

O aplicativo pode ser publicado sob um prefixo (por exemplo `http://192.168.10.161/boletim_ti/`) atrás de um proxy reverso que **mantém** o prefixo ao repassar. Com `BASE_PATH=/boletim_ti`, todas as rotas, estáticos, redirecionamentos e o cookie de sessão (`boletim.sid`, `Path=/boletim_ti`) ficam sob o prefixo; fora dele o app responde 404, exceto `GET /saude`, que existe na raiz e sob o prefixo.

Guias de operação (escritos para Apache2 + Docker; **não foram executados numa máquina com Docker/Apache**, veja os avisos em cada um):

- [deploy/apache/README.md](deploy/apache/README.md): proxy, restrição por rede, exceção na regra HTTP→HTTPS, validação e reversão (snippet em `deploy/apache/boletim_ti.conf`).
- [deploy/docker/README.md](deploy/docker/README.md): `Dockerfile`, build, `docker run`, env-file e teste de fumaça da exportação.
- [deploy/ATUALIZACAO.md](deploy/ATUALIZACAO.md): atualização em produção e rollback.

Variáveis relacionadas:

| Variável | Efeito |
|----------|--------|
| `BASE_PATH` | Prefixo de publicação (`/segmento[/segmento]`; ausente/vazio = raiz). Valor inválido impede a subida |
| `COOKIE_SECURE` | Cookie de sessão `secure` (padrão `true`). Use `false` apenas enquanto o acesso for HTTP |
| `HOST` | Endereço de escuta (padrão `127.0.0.1`). No contêiner é `0.0.0.0`, com a porta publicada só em `127.0.0.1` |
| `PORT` | Porta de escuta (padrão `3000`) |
| `CHROMIUM_PATH` | Caminho do Chromium/Chrome/Edge para exportar (no contêiner: `/usr/bin/chromium`) |
| `CHROMIUM_NO_SANDBOX` | `1` inicia o Chromium com `--no-sandbox` (último recurso: contêiner/AppArmor) |

No Windows com Git Bash, caminhos que começam com `/` em argumentos (por exemplo `BASE_PATH=/boletim_ti` na linha de comando) são convertidos para caminhos do Windows. Prefixe o comando com `MSYS_NO_PATHCONV=1` ou defina a variável no `.env`.
