# Docker: construir e executar o Comunicado Semanal

Guia para construir a imagem `boletim-senar:1.1` (com suporte a `BASE_PATH`) e subir o contêiner no servidor, reproduzindo as configurações do contêiner atual (`boletim-senar:1.0`). A publicação em `/boletim_ti/` pelo Apache está em [../apache/README.md](../apache/README.md); o passo a passo de atualização e rollback está em [../ATUALIZACAO.md](../ATUALIZACAO.md).

> **O que NÃO foi validado:** a máquina de desenvolvimento não tem Docker, então o `Dockerfile` **não foi construído nem executado** aqui (estado: não validado nesta máquina). Foi conferido apenas por testes estáticos (`tests/deploy-files.test.js`) e revisão. Em especial, **não foi testado** o `puppeteer-core` 25 com o `chromium` do Debian bookworm: a versão do Chromium do Debian pode ser mais antiga que a que o puppeteer-core 25 tem como alvo (o protocolo CDP costuma ser tolerante, mas a combinação não foi testada). O **teste de fumaça da seção 5 é o portão** antes de trocar o tráfego.

## 1. O que a imagem contém

- Base `node:22-bookworm-slim`; Chromium do Debian em `/usr/bin/chromium` e fontes (`fonts-noto-color-emoji`, `fonts-noto-core`, `fonts-liberation`) para os glifos do PDF/PNG.
- `npm ci --omit=dev` (sem devDependencies), `src/`, `scripts/create-admin.js` e `scripts/smoke-export.js`.
- Roda como o usuário não privilegiado `node`, porta interna 3000, `HEALTHCHECK` em `GET http://127.0.0.1:3000/saude`. O `/saude` responde **na raiz** mesmo com `BASE_PATH` definido (e também sob o prefixo), então o healthcheck não depende do prefixo.
- **Nenhum segredo na imagem.** Tudo vem do `--env-file` em tempo de execução.

## 2. Arquivo de variáveis (fora do repositório)

Crie `/etc/boletim/boletim.env` (modo `600`, dono `root`). O `docker run --env-file` lê linhas `CHAVE=valor` **cruas**: sem aspas (elas viram parte do valor), sem `export`, sem espaços em volta do `=`, e sem comentário na mesma linha do valor (`#` só funciona no início da linha).

**O arquivo precisa ter fim de linha Unix (LF).** Se for editado no Windows (CRLF), `COOKIE_SECURE=false\r` vira outro valor (o app trata como `true`) e o login entra em laço com cookie `secure`. Confira:

```bash
file /etc/boletim/boletim.env          # não pode dizer "with CRLF line terminators"
grep -c $'\r' /etc/boletim/boletim.env # deve imprimir 0
# corrigir, se preciso:  sudo sed -i 's/\r$//' /etc/boletim/boletim.env
```

```
DB_HOST=172.17.0.1
DB_PORT=3306
DB_USER=boletim
DB_PASSWORD=<senha-do-banco>
DB_NAME=boletim
SESSION_SECRET=<saida-de-openssl-rand-hex-32>
COOKIE_SECURE=false
BASE_PATH=/boletim_ti
CHROMIUM_NO_SANDBOX=1
```

- `SESSION_SECRET`: gere com `openssl rand -hex 32` (trocar o valor desconecta todos). Se o contêiner antigo já tem um, reaproveite-o.
- `DB_*`: use os valores do contêiner atual. O MariaDB 10.5 fica no host, acessível pelo gateway da rede docker (`172.17.0.1:3306`); o usuário do banco precisa aceitar conexões dessa origem.
- `COOKIE_SECURE=false` **só enquanto o acesso for HTTP**. Ao migrar para HTTPS, mude para `true` (e o Apache precisa enviar `X-Forwarded-Proto`; veja o guia do Apache).
- `BASE_PATH=/boletim_ti`: prefixo de publicação. O Apache mantém o prefixo ao repassar.
- `CHROMIUM_NO_SANDBOX=1`: o Chromium como usuário não-root dentro do Docker normalmente não consegue criar o sandbox (user namespaces bloqueados pelo perfil padrão). Se o smoke test da seção 5 passar **sem** essa variável, remova-a. É o último recurso: reduz o isolamento do Chromium, e o contêiner só renderiza conteúdo do próprio sistema.
- Não defina `HOST`, `PORT` nem `CHROMIUM_PATH` no env-file: a imagem já traz `HOST=0.0.0.0`, `PORT=3000`, `CHROMIUM_PATH=/usr/bin/chromium`.
- `HOST=0.0.0.0` **dentro** do contêiner é intencional: só assim a porta publicada alcança o processo. O isolamento vem da publicação `-p 127.0.0.1:3100:3000` (somente loopback do host). Nunca publique como `-p 3100:3000`.

## 3. Construir

No servidor, em `/opt/boletim_ti`, com o branch/tag desejado já em uso (veja [../ATUALIZACAO.md](../ATUALIZACAO.md)):

```bash
cd /opt/boletim_ti
docker build -t boletim-senar:1.1 .
```

Mantenha a tag `boletim-senar:1.0` intacta: é o caminho de rollback.

## 4. Executar

Com o contêiner antigo parado (a porta 3100 não pode estar em uso; sequência completa em [../ATUALIZACAO.md](../ATUALIZACAO.md)):

```bash
docker run -d \
  --name boletim \
  --restart unless-stopped \
  --init \
  --shm-size=512m \
  -p 127.0.0.1:3100:3000 \
  --env-file /etc/boletim/boletim.env \
  boletim-senar:1.1
```

Por que `--shm-size=512m` e `--init`:

- **`--shm-size=512m`** (use de 512m a 1g): o `/dev/shm` padrão do Docker tem 64 MB e o Chromium usa memória compartilhada para renderizar; com 64 MB, capturas altas e PDFs falham com "Target closed"/"page crashed". É a **primeira** providência se a exportação falhar (seção 5).
- **`--init`**: coloca um init mínimo como PID 1 para encerrar processos órfãos do Chromium (zumbis) e repassar sinais ao Node.

Verificação:

```bash
docker ps --filter "name=^/boletim\$"     # STATUS "Up ... (healthy)" após ~30 s
docker logs --tail 50 boletim            # sem erros de banco/configuração
curl -i http://127.0.0.1:3100/saude                 # 200 {"ok":true}
curl -i http://127.0.0.1:3100/boletim_ti/saude      # 200 {"ok":true}
curl -i http://127.0.0.1:3100/boletim_ti/login      # 200 e Set-Cookie: boletim.sid=...; Path=/boletim_ti
curl -i http://127.0.0.1:3100/boletim_ti/           # 302 Location: /boletim_ti/login (sem sessão)
curl -i http://127.0.0.1:3100/login                 # 404: fora do prefixo o app não responde
docker port boletim                                 # deve mostrar 127.0.0.1:3100, nunca 0.0.0.0
# (ss -ltnp | grep 3100 pode não mostrar nada se o userland-proxy do Docker estiver desligado; use docker port e curl)
```

Se o contêiner reiniciar em laço, `docker logs boletim` mostra a causa; um `BASE_PATH` inválido ou variável obrigatória ausente impede a subida (comportamento esperado).

Comandos úteis: `docker logs -f boletim`, `docker restart boletim` (**não relê** o env-file: para mudar variáveis é preciso `docker rm -f boletim` e um novo `docker run`), `docker exec -it boletim sh`.

Criar um administrador (se ainda não existir): `docker exec -it boletim node scripts/create-admin.js "<nome>" <login>`. A senha é pedida no terminal, sem eco (exige `-it`); as variáveis do banco já estão no ambiente do contêiner.

## 5. Teste de fumaça da exportação (portão antes de trocar o tráfego)

Renderiza uma edição de exemplo com o Chromium **do contêiner** e confere PDF de 1 página e os PNGs. Não usa banco.

```bash
docker exec boletim node scripts/smoke-export.js /tmp/smoke      # esperado: todas as linhas PASS, código de saída 0
docker cp boletim:/tmp/smoke /tmp/smoke-boletim                 # copia os arquivos para inspeção (fora do checkout do git)
ls -l /tmp/smoke-boletim
```

Abra o PDF e os PNGs: o final do bloco "Dica" (“Teste de glifos”) deve mostrar ícones/emoji, não quadrados.

Se a exportação falhar, nesta ordem:

1. **`/dev/shm` pequeno** (sintoma: "Target closed", "page crashed", falha só em páginas altas): confirme que o contêiner foi criado com `--shm-size=512m` (ou 1g). `docker inspect -f '{{.HostConfig.ShmSize}}' boletim` deve mostrar 536870912 ou mais (o padrão, 67108864, é pouco).
2. **Sandbox do Chromium** (sintoma: erro de namespace/"No usable sandbox"): defina `CHROMIUM_NO_SANDBOX=1` no env-file e recrie o contêiner.
3. Outra falha (protocolo/versão do Chromium): **não troque o tráfego**; volte ao `boletim-senar:1.0` e reporte o erro.

Para testar a imagem sem tocar no contêiner em produção, use um contêiner descartável (sem publicar porta e sem banco):

```bash
docker run --rm --init --shm-size=512m -e CHROMIUM_NO_SANDBOX=1 boletim-senar:1.1 node scripts/smoke-export.js /tmp/smoke
```

## 6. Notas

- Estado desta documentação: **não validado nesta máquina** (sem Docker nem Apache). Registre no relatório de implantação o resultado real do `docker build`, do healthcheck e do smoke test.
- O `HEALTHCHECK` usa `fetch` do Node 22 (`node -e`); não depende de `curl` na imagem.
- Tamanho esperado da imagem: algumas centenas de MB (Chromium e fontes).
- Atualizações de segurança do Debian entram ao reconstruir a imagem (`docker build --pull`).
- **Versão do Chromium:** o pacote `chromium` do Debian bookworm pode ter versão diferente (mais antiga) da que o puppeteer-core 25 tem como alvo; o smoke test da seção 5 é o portão. Reconstrua a imagem periodicamente (`docker build --pull`) e, se necessário, avalie uma base Debian mais nova (por exemplo `node:22-trixie-slim`). O `Dockerfile` atual foi mantido em bookworm.
- O `env-file` do Docker é só para o contêiner: não copie para ele `HOST=127.0.0.1` nem `CHROMIUM_PATH=/usr/bin/google-chrome-stable` do `deploy/boletim.env.example` (que é para uso com systemd). A imagem define `HOST=0.0.0.0` e `CHROMIUM_PATH=/usr/bin/chromium`, e esses valores precisam prevalecer (variáveis do `--env-file` sobrescrevem as do `ENV` da imagem).
