# Atualização e Rollback em produção (publicação em `/boletim_ti/`)

Procedimento para passar do `boletim-senar:1.0` (hoje na porta 3100, sem prefixo) para o `boletim-senar:1.1` (com `BASE_PATH=/boletim_ti`) atrás do Apache, e como voltar atrás. Detalhes em [docker/README.md](docker/README.md) e [apache/README.md](apache/README.md).

> **Aviso de validação:** nenhum destes passos foi executado numa máquina com Docker ou Apache (a máquina de desenvolvimento não tem nenhum dos dois). Os comandos foram escritos e revisados com cuidado, mas o primeiro `docker build`, o primeiro `apachectl configtest` e o smoke test do Chromium acontecerão em produção. Siga a ordem e os pontos de parada.

Execute os comandos como root (`sudo -i`) ou com `sudo` exatamente como escritos (os redirecionamentos para `/root` já estão dentro de `sudo sh -c`).

## Princípios

- **Ordem segura: aplicação antes do Apache.** Primeiro o novo contêiner é validado direto em `127.0.0.1` (porta reserva e depois 3100); só então o Apache é alterado.
- **Não toque** em outros contêineres, em outros VirtualHosts/sites do Apache, nem no banco (nenhum `DROP`/recriação).
- **Banco: a versão 1.1 não faz nenhuma mudança de schema.** Existe só `src/db/migrations/001_init.sql`, este branch não adiciona migração, e a tabela de sessões é a mesma do `express-mysql-session`. Logo `1.0` e `1.1` são idênticas em schema, desde que a `1.0` tenha sido construída com o código deste repositório no commit `d87e8df` ou posterior. A única verificação real é `SELECT nome FROM schema_migrations;` mostrar apenas `001_init.sql` (passo 0).
- Cada etapa tem validação; se falhar, pare e vá para o Rollback (a imagem `1.0` e o contêiner antigo permanecem intactos até o fim).
- Sessões: o cookie passa de `sid` para `boletim.sid` (com `Path=/boletim_ti`). Sessões antigas simplesmente expiram; os usuários entram de novo uma vez. Nenhum dado é perdido.
- Indisponibilidade: só entre `docker stop` do antigo e o novo ficar saudável (o app responde em alguns segundos; o status `healthy` leva até ~30 s). Para reduzir o risco, o passo 2 valida o `1.1` antes, em porta reserva, sem derrubar o `1.0`.

## Atualização

### 0. Preparação (sem impacto)

**0.1 Descobrir o contêiner real** (não suponha o nome):

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
```

Identifique a linha com `boletim-senar:1.0` publicada em `127.0.0.1:3100->3000/tcp`. Defina o nome exato (ele será usado em todos os comandos abaixo; confira com correspondência exata, sem filtro por trecho):

```bash
ANTIGO=boletim            # troque se o nome real for outro
docker ps -a --filter "name=^/${ANTIGO}\$" --format '{{.Names}} {{.Image}} {{.Status}}'    # deve listar exatamente 1 linha
POLITICA_ANTIGO=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$ANTIGO")
echo "$ANTIGO / politica de reinicio: $POLITICA_ANTIGO"   # ANOTE estes dois valores: o rollback precisa deles
```

**0.2 Código e rota atual**

```bash
cd /opt/boletim_ti
git status                      # deve estar limpo
git fetch --all --tags
git branch --show-current       # anote: branch/tag atual (para o rollback do código)
git rev-parse --short HEAD
grep -RIn "127.0.0.1:3100\|localhost:3100" /etc/apache2/ /etc/nginx/ 2>/dev/null
```

O último comando mostra se já existe um proxy/vhost apontando para a 3100 (rota atual dos usuários). Depois do cutover o `1.1` responde 404 fora de `/boletim_ti/`; essa rota deve ser migrada para a URL com prefixo ou aposentada, combinando com quem a usa (ver [apache/README.md](apache/README.md)). Não a remova antes de validar o caminho novo.

**0.3 Backup do banco** (precaução). As credenciais vêm de um arquivo de opções com modo `600`, nunca na linha de comando. Crie-o uma vez:

```bash
# Conteúdo de /root/.boletim-dump.cnf:
#   [client]
#   user=<usuario-do-banco>
#   password=<senha-do-banco>
#   host=127.0.0.1
sudo install -m 600 /dev/null /root/.boletim-dump.cnf && sudo nano /root/.boletim-dump.cnf
```

O redirecionamento precisa rodar como root, por isso o comando inteiro vai dentro de `sudo sh -c` (troque `<nome-do-banco>`):

```bash
sudo sh -c 'mkdir -p /root/backups-boletim && mysqldump --defaults-extra-file=/root/.boletim-dump.cnf --single-transaction --routines <nome-do-banco> | gzip > /root/backups-boletim/boletim-$(date +%Y%m%d-%H%M%S).sql.gz'
# Verificar o dump mais recente: integridade, tamanho e o rodapé "Dump completed"
sudo sh -c 'f=$(ls -t /root/backups-boletim/*.sql.gz | head -1); echo "$f"; gzip -t "$f" && test -s "$f" && ls -l "$f" && zcat "$f" | tail -n 2'
```

Esperado: `gzip -t` sem erro, tamanho maior que zero e `-- Dump completed on ...` nas últimas linhas. Se o dump falhar, pare.

**0.4 Conferir o schema** (a única verificação real; ver Princípios):

```bash
sudo mysql --defaults-extra-file=/root/.boletim-dump.cnf <nome-do-banco> -e 'SELECT nome FROM schema_migrations;'
```

Esperado: apenas `001_init.sql`.

**0.5 Registrar a configuração do contêiner antigo** (os valores são sensíveis: grave num arquivo `600`, não cole em chamados):

```bash
sudo sh -c "umask 077; docker inspect $ANTIGO > /root/boletim-1.0-inspect.json"
```

**0.6 Env-file.** Crie/ajuste `/etc/boletim/boletim.env` (modo `600`) conforme [docker/README.md](docker/README.md) (`DB_*` e `SESSION_SECRET` iguais aos do antigo, mais `COOKIE_SECURE=false`, `BASE_PATH=/boletim_ti`, e `CHROMIUM_NO_SANDBOX=1` se necessário). Não copie `HOST`/`CHROMIUM_PATH` do `deploy/boletim.env.example` (é para systemd).

### 1. Obter o código e construir a imagem

```bash
cd /opt/boletim_ti
git checkout <branch-ou-tag-indicado>      # ex.: feat/base-path ou a tag da versão
git pull --ff-only                         # se for um branch
docker build -t boletim-senar:1.1 .
docker images boletim-senar                # 1.0 e 1.1 devem aparecer
```

Validação: o build termina sem erro. **Não** remova a `1.0`.

### 2. Validar o 1.1 em porta reserva (antes de tocar no 1.0)

O `1.1` sobe ao lado do `1.0`, na porta 3101, contra o mesmo banco. Isso é inofensivo: não há migração nova (a tabela `schema_migrations` já está completa) e as sessões ficam na mesma tabela, mas com cookie de nome diferente (`boletim.sid` vs `sid`), então os dois não se atrapalham.

```bash
docker run -d --name boletim-teste --init --shm-size=512m \
  -p 127.0.0.1:3101:3000 --env-file /etc/boletim/boletim.env boletim-senar:1.1
```

- [ ] `docker ps --filter "name=^/boletim-teste\$"` → `Up` e, após ~30 s, `(healthy)`; `docker logs --tail 50 boletim-teste` sem erros
- [ ] `curl -i http://127.0.0.1:3101/saude` → `200 {"ok":true}`
- [ ] `curl -i http://127.0.0.1:3101/boletim_ti/login` → `200` com `Set-Cookie: boletim.sid=...; Path=/boletim_ti`
- [ ] Smoke test do Chromium: `docker exec boletim-teste node scripts/smoke-export.js /tmp/smoke` → todas as linhas `PASS`. Se falhar, siga a ordem de remédios do [docker/README.md](docker/README.md) seção 5 (primeiro `--shm-size`, depois sandbox). O `chromium` do Debian é mais antigo que o Chrome-alvo do `puppeteer-core` 25 e não foi testado na máquina de desenvolvimento. **Se continuar falhando, pare aqui** (nada foi alterado no `1.0`).
- [ ] Login pelo navegador em `http://127.0.0.1:3101/boletim_ti/` (túnel SSH: `ssh -L 3101:127.0.0.1:3101 usuario@192.168.10.161`): abrir uma edição, publicar e baixar PDF/PNG

Quando tudo passar, remova o contêiner de teste:

```bash
docker rm -f boletim-teste
```

### 3. Trocar o contêiner (cutover da aplicação)

```bash
docker stop "$ANTIGO"
docker update --restart=no "$ANTIGO"                 # senão (ex.: política "always") ele volta após reinício do Docker/host e disputa a porta 3100
docker rename "$ANTIGO" "${ANTIGO}-1.0-antigo"       # mantém o antigo parado, para o rollback
docker run -d --name boletim --restart unless-stopped --init --shm-size=512m \
  -p 127.0.0.1:3100:3000 --env-file /etc/boletim/boletim.env boletim-senar:1.1
```

Validação (direto no contêiner, ainda sem Apache):

- [ ] `docker ps --filter "name=^/boletim\$"` mostra `boletim-senar:1.1`, `Up` e, após ~30 s, `(healthy)`
- [ ] `docker port boletim` → `127.0.0.1:3100` (nunca `0.0.0.0`)
- [ ] `docker logs --tail 50 boletim` sem erros
- [ ] `curl -i http://127.0.0.1:3100/saude` → `200 {"ok":true}`
- [ ] `curl -i http://127.0.0.1:3100/boletim_ti/saude` → `200`
- [ ] `curl -i http://127.0.0.1:3100/boletim_ti/login` → `200` com `Set-Cookie: boletim.sid=...; Path=/boletim_ti`
- [ ] Login no navegador via `http://127.0.0.1:3100/boletim_ti/` (túnel SSH como no passo 2, porta 3100)

Se algo falhar: Rollback, seção "Só a aplicação".

### 4. Apache (somente depois da aplicação validada)

Siga [apache/README.md](apache/README.md): descoberta da rota existente, backup datado do arquivo **resolvido** de `000-default.conf` (`readlink -f`, é um link simbólico no Ubuntu), copiar o snippet, **preencher a faixa autorizada** (`FAIXA_AUTORIZADA_AQUI`), adicionar a `RewriteCond` de exceção e o `IncludeOptional`, `sudo apachectl configtest`, `sudo systemctl reload apache2`, e conferir o log de erros por avisos de "worker sharing".

Validação (matriz completa no README do Apache):

- [ ] `curl -i http://192.168.10.161/boletim_ti/` → `302` para `/boletim_ti/login` (sem HTTPS)
- [ ] `curl -i http://192.168.10.161/boletim_ti` → `301` para `/boletim_ti/`
- [ ] Login pelo navegador em `http://192.168.10.161/boletim_ti/`, exportação OK
- [ ] De fora da faixa autorizada → `403`
- [ ] Um outro sistema do servidor segue redirecionando HTTP→HTTPS como antes
- [ ] A rota antiga para a 3100 (passo 0.2), se existia, foi migrada para a URL com prefixo ou aposentada

### 5. Depois

- Se tudo certo, mantenha `${ANTIGO}-1.0-antigo` parado (com `--restart=no`) e a imagem `1.0` por alguns dias. Para descartar: `docker rm "${ANTIGO}-1.0-antigo"` (apenas ele).
- Agende a migração para HTTPS (passos em [apache/README.md](apache/README.md) seção 7: `a2enmod headers`, `Include` no `:443`, remover a exceção HTTP e `COOKIE_SECURE=true`, tudo junto). Enquanto for HTTP, as credenciais trafegam em texto claro na rede interna.

## Rollback

Reverta na **ordem inversa**: primeiro o Apache, depois a aplicação. Se abriu um novo terminal, redefina as variáveis anotadas no passo 0.1 (`ANTIGO` e `POLITICA_ANTIGO`).

### Apache (se já foi alterado)

1. Restaurar o backup **para dentro do arquivo resolvido** (o link simbólico de `sites-enabled` deve ser preservado):
   ```bash
   DESTINO="$(readlink -f /etc/apache2/sites-enabled/000-default.conf)"
   ls -l /root/apache-backups/                      # confirme que o backup é arquivo comum
   sudo cp -p /root/apache-backups/000-default.conf.<DATA> "$DESTINO"
   sudo diff /root/apache-backups/000-default.conf.<DATA> "$DESTINO" && echo "restaurado: idêntico ao backup"
   ```
   (Alternativa: remover manualmente a `RewriteCond` de exceção e a linha `IncludeOptional`.)
2. `sudo apachectl configtest` → `Syntax OK`
3. `sudo systemctl reload apache2`
4. Conferir que os outros sistemas seguem normais (HTTP→HTTPS intacto) e, se a rota antiga para a 3100 tinha sido alterada, restaurá-la.

### Só a aplicação (voltar ao `boletim-senar:1.0`)

```bash
docker update --restart=no boletim                    # o NOVO: evita que volte sozinho após reinício
docker stop boletim && docker rm boletim              # o NOVO (1.1)
docker rename "${ANTIGO}-1.0-antigo" "$ANTIGO"
docker update --restart "${POLITICA_ANTIGO:-unless-stopped}" "$ANTIGO"    # restaura a política original (anotada no passo 0.1)
docker start "$ANTIGO"
```

Se o contêiner antigo não existir mais, suba um novo da imagem `1.0` com a configuração anterior (valores em `/root/boletim-1.0-inspect.json`):

```bash
docker run -d --name "$ANTIGO" --restart unless-stopped \
  -p 127.0.0.1:3100:3000 --env-file <env-file-ou-variaveis-anteriores> boletim-senar:1.0
```

Validação do rollback:

- [ ] `docker ps --filter "name=^/${ANTIGO}\$"` mostra `boletim-senar:1.0`, `Up`
- [ ] `docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$ANTIGO"` igual ao anotado
- [ ] `curl -i http://127.0.0.1:3100/saude` → `200`
- [ ] Login funcionando como antes (sessões do cookie `sid` antigo podem ter expirado: o usuário apenas entra de novo)
- [ ] Código: `cd /opt/boletim_ti && git checkout <branch-ou-tag-anotado-no-passo-0.2>`

### Banco

Nada a reverter: não há mudança de schema (ver Princípios). **Não** restaure o dump a menos que haja corrupção comprovada (restaurar apaga o que foi editado depois do backup).

## O que NÃO tocar

- Outros contêineres e suas redes/volumes.
- Outros VirtualHosts, sites habilitados e módulos do Apache (só o `000-default.conf`, nos pontos descritos, e o diretório `/etc/apache2/boletim/`).
- O banco de dados (sem `DROP`, sem recriar, sem editar tabelas manualmente).
- A porta 3100 (e a 3101 de teste) devem continuar só em `127.0.0.1`.
