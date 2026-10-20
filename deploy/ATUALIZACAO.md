# Atualização e Rollback em produção (publicação em `/boletim_ti/`)

Procedimento para passar do `boletim-senar:1.0` (hoje na porta 3100, sem prefixo) para o `boletim-senar:1.1` (com `BASE_PATH=/boletim_ti`) atrás do Apache, e como voltar atrás. Detalhes em [docker/README.md](docker/README.md) e [apache/README.md](apache/README.md).

> **Aviso de validação:** nenhum destes passos foi executado numa máquina com Docker ou Apache (a máquina de desenvolvimento não tem nenhum dos dois). Os comandos foram escritos e revisados com cuidado, mas o primeiro `docker build`, o primeiro `apachectl configtest` e o smoke test do Chromium acontecerão em produção. Siga a ordem e os pontos de parada.

Execute os comandos como root (`sudo -i`) ou com `sudo` exatamente como escritos (os redirecionamentos para `/root` já estão dentro de `sudo sh -c`).

## Princípios

- **Ordem segura: aplicação antes do Apache.** Primeiro o novo contêiner é validado direto em `127.0.0.1` (porta reserva e depois 3100); só então o Apache é alterado.
- **Não toque** em outros contêineres, em outros VirtualHosts/sites do Apache, nem no banco (nenhum `DROP`/recriação).
- **Banco: a versão 1.1 aplica migrações aditivas (`002_link_publico.sql` e `003_imagens.sql`).** A `002` acrescenta a coluna `edicoes.token_publico` (anulável) e um índice único; a `003` cria a tabela `imagens`. Nenhuma remove nem altera nada existente. A imagem `1.0` ignora a coluna e a tabela novas, então o banco migrado continua válido para a `1.0` (é o que torna o rollback seguro). As migrações rodam sozinhas na primeira subida da `1.1` e são re-executáveis (a `003` usa `CREATE TABLE IF NOT EXISTS`; a tabela guarda as imagens opcionais dos blocos). A tabela de sessões é a mesma do `express-mysql-session`. Verificação (passo 0.4): antes, `SELECT nome FROM schema_migrations;` mostra apenas `001_init.sql`; depois da primeira subida da `1.1` mostra `001_init.sql`, `002_link_publico.sql` e `003_imagens.sql`.
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
TENTATIVAS_ANTIGO=$(docker inspect -f '{{.HostConfig.RestartPolicy.MaximumRetryCount}}' "$ANTIGO")
echo "$ANTIGO / politica de reinicio: $POLITICA_ANTIGO (tentativas: $TENTATIVAS_ANTIGO)"   # ANOTE: o rollback precisa destes valores
```

Se a política for `on-failure`, o número de tentativas (`MaximumRetryCount`) também precisa ser restaurado (use `on-failure:<N>`); por isso ele é registrado acima. No rollback as variáveis são obrigatórias (sem valor padrão): se estiverem vazias, o comando aborta em vez de adivinhar.

Defina também o nome do contêiner NOVO e garanta que ele não colide com um contêiner que não seja o antigo (o rollback faz `docker rm` nesse nome):

```bash
NOVO=boletim
EXISTE=$(docker ps -a --filter "name=^/${NOVO}\$" --format '{{.Names}}')
if [ -n "$EXISTE" ] && [ "$EXISTE" != "$ANTIGO" ]; then echo "ATENCAO: ja existe '$EXISTE' e NAO e o antigo; escolha outro NOVO (ex.: NOVO=boletim-v11)"; fi
echo "novo contêiner: $NOVO"       # ANOTE também este nome
```

Só continue se não aparecer o aviso (ou depois de escolher outro `NOVO`). Todos os comandos abaixo usam `$NOVO`.

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

**0.3 Backup do banco** (precaução). As credenciais vêm de um arquivo de opções com modo `600`, nunca na linha de comando. Use o **mesmo host e porta que o contêiner usa** (`DB_HOST`/`DB_PORT` do env-file, aqui `172.17.0.1:3306`): a partir do host, `127.0.0.1` pode cair em outra conta do MariaDB (ou nem conectar), já que as permissões do usuário do app são concedidas para a origem da rede docker.

Permissões necessárias para o dump: `SELECT`, `LOCK TABLES` (ou use `--single-transaction`, como abaixo, que dispensa o lock em tabelas InnoDB), `SHOW VIEW` e, se houver, `TRIGGER` e `EVENT`. Se o usuário do app não tiver essas permissões, use uma conta já existente com leitura suficiente (por exemplo uma conta de administração do banco); não crie contas novas por conta própria e nunca coloque a senha na linha de comando. Crie o arquivo uma vez:

```bash
# Conteúdo de /root/.boletim-dump.cnf:
#   [client]
#   user=<usuario-do-banco>
#   password=<senha-do-banco>
#   host=172.17.0.1
#   port=3306
sudo install -m 600 /dev/null /root/.boletim-dump.cnf && sudo nano /root/.boletim-dump.cnf
```

O redirecionamento precisa rodar como root, por isso o comando inteiro vai dentro de `sudo sh -c` (troque `<nome-do-banco>`):

```bash
sudo sh -c 'mkdir -p /root/backups-boletim && mysqldump --defaults-extra-file=/root/.boletim-dump.cnf --single-transaction --routines <nome-do-banco> | gzip > /root/backups-boletim/boletim-$(date +%Y%m%d-%H%M%S).sql.gz'
# Verificar o dump mais recente: integridade, tamanho e o rodapé "Dump completed"
sudo sh -c 'f=$(ls -t /root/backups-boletim/*.sql.gz | head -1); echo "$f"; gzip -t "$f" && test -s "$f" && ls -l "$f" && zcat "$f" | tail -n 2'
```

Esperado: `gzip -t` sem erro, tamanho maior que zero e `-- Dump completed on ...` nas últimas linhas. Se o dump falhar, pare.

**Alternativa quando o `mysqldump` do host é negado** (ex.: `Access denied for user 'boletim_app'@'<ip-do-host>'`, porque o usuário do app só tem permissão vinda da rede docker, e não há outra conta administrativa à mão). O `scripts/backup-sql.js` gera um backup lógico (`.sql`, somente leitura, com `START TRANSACTION WITH CONSISTENT SNAPSHOT`) usando o próprio usuário do app, rodando num contêiner da rede docker; ele já vem no repositório (basta o `git pull`). As sessões (`sessions`) saem só com a estrutura. O backup só vale se terminar com `-- Backup completo`:

```bash
sudo mkdir -p /root/backups-boletim
sudo docker run --rm --env-file /etc/boletim/boletim.env -e NODE_PATH=/app/node_modules \
  -v /opt/boletim_ti/scripts/backup-sql.js:/tmp/backup-sql.js:ro boletim-senar:1.1 node /tmp/backup-sql.js \
  | sudo sh -c 'gzip > /root/backups-boletim/boletim-$(date +%Y%m%d-%H%M%S).sql.gz'
sudo sh -c 'f=$(ls -t /root/backups-boletim/*.sql.gz | head -1); ls -l "$f"; gzip -t "$f" && zcat "$f" | tail -n 2'
```

Para restaurar: `zcat arquivo.sql.gz | mysql <nome-do-banco>` com uma conta que tenha `CREATE`/`DROP`/`INSERT` (o arquivo recria as tabelas).

**0.4 Conferir o schema** (a única verificação real; ver Princípios):

```bash
sudo mysql --defaults-extra-file=/root/.boletim-dump.cnf <nome-do-banco> -e 'SELECT nome FROM schema_migrations;'
```

Esperado agora: apenas `001_init.sql`. Depois que a `1.1` subir pela primeira vez (passo 2 ou 3), repita o comando: devem aparecer `001_init.sql`, `002_link_publico.sql` e `003_imagens.sql`.

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

O `1.1` sobe ao lado do `1.0`, na porta 3101, contra o mesmo banco. Atenção: é este contêiner de teste que aplica as migrações `002_link_publico.sql` e `003_imagens.sql` no banco compartilhado (aditivas, e a `1.0` as ignora). As sessões ficam na mesma tabela, mas com cookie de nome diferente (`boletim.sid` vs `sid`), então os dois não se atrapalham.

```bash
docker run -d --name boletim-teste --init --shm-size=512m \
  -p 127.0.0.1:3101:3000 --env-file /etc/boletim/boletim.env boletim-senar:1.1
```

- [ ] `docker ps --filter "name=^/boletim-teste\$"` → `Up` e, após ~30 s, `(healthy)`; `docker logs --tail 50 boletim-teste` sem erros
- [ ] `curl -i http://127.0.0.1:3101/saude` → `200 {"ok":true}`
- [ ] `curl -i http://127.0.0.1:3101/boletim_ti/login` → `200` com `Set-Cookie: boletim.sid=...; Path=/boletim_ti`
- [ ] Smoke test do Chromium: `docker exec boletim-teste node scripts/smoke-export.js /tmp/smoke` → todas as linhas `PASS`. Se falhar, siga a ordem de remédios do [docker/README.md](docker/README.md) seção 5 (primeiro `--shm-size`, depois sandbox). O `chromium` do Debian pode ser mais antigo que o Chrome-alvo do `puppeteer-core` 25, e essa combinação não foi testada na máquina de desenvolvimento. **Se continuar falhando, pare aqui** e remova o contêiner de teste (`docker rm -f boletim-teste`: ele guarda as credenciais do banco no ambiente e escuta em `127.0.0.1:3101`). Nada foi alterado no `1.0`.
- [ ] Login pelo navegador em `http://127.0.0.1:3101/boletim_ti/` (túnel SSH: `ssh -L 3101:127.0.0.1:3101 usuario@192.168.10.161`): abrir uma edição, publicar e baixar PDF/PNG

Quando tudo passar (ou se algo falhar), remova o contêiner de teste **antes** de seguir para o passo 3:

```bash
docker rm -f boletim-teste
```

### 3. Trocar o contêiner (cutover da aplicação)

```bash
docker stop "$ANTIGO"
docker update --restart=no "$ANTIGO"                 # senão (ex.: política "always") ele volta após reinício do Docker/host e disputa a porta 3100
docker rename "$ANTIGO" "${ANTIGO}-1.0-antigo"       # mantém o antigo parado, para o rollback
docker run -d --name "$NOVO" --restart unless-stopped --init --shm-size=512m \
  -p 127.0.0.1:3100:3000 --env-file /etc/boletim/boletim.env boletim-senar:1.1
```

Validação (direto no contêiner, ainda sem Apache):

- [ ] `docker ps --filter "name=^/${NOVO}\$"` mostra `boletim-senar:1.1`, `Up` e, após ~30 s, `(healthy)`
- [ ] `docker port "$NOVO"` → `127.0.0.1:3100` (nunca `0.0.0.0`)
- [ ] `docker logs --tail 50 "$NOVO"` sem erros
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

Reverta na **ordem inversa**: primeiro o Apache, depois a aplicação. O rollback da aplicação só remove o contêiner `$NOVO` se a imagem dele for `boletim-senar:1.1` (guard por imagem; se o passo 3 falhou antes do `docker rename`, `$NOVO` pode ser o próprio 1.0). Se abriu um novo terminal, redefina as variáveis anotadas no passo 0.1 (`ANTIGO`, `NOVO`, `POLITICA_ANTIGO` e `TENTATIVAS_ANTIGO`).

### Apache (se já foi alterado)

1. Restaurar o backup **para dentro do arquivo resolvido** (o link simbólico de `sites-enabled` deve ser preservado):
   ```bash
   DESTINO="$(readlink -f /etc/apache2/sites-enabled/000-default.conf)"
   sudo ls -l /root/apache-backups/                 # confirme que o backup é arquivo comum
   sudo cp -p /root/apache-backups/000-default.conf.<DATA> "$DESTINO"
   sudo diff /root/apache-backups/000-default.conf.<DATA> "$DESTINO" && echo "restaurado: idêntico ao backup"
   ```
   (Alternativa: remover manualmente a `RewriteCond` de exceção e a linha `IncludeOptional`.)
2. `sudo apachectl configtest` → `Syntax OK`
3. `sudo systemctl reload apache2`
4. Conferir que os outros sistemas seguem normais (HTTP→HTTPS intacto) e, se a rota antiga para a 3100 tinha sido alterada, restaurá-la.

### Só a aplicação (voltar ao `boletim-senar:1.0`)

```bash
docker rm -f boletim-teste 2>/dev/null                # contêiner de teste do passo 2, se ainda existir (tem credenciais do banco no ambiente)
IMG_NOVO="$(docker inspect -f '{{.Config.Image}}' "${NOVO:?defina no passo 0.1}" 2>/dev/null)"
if [ "$IMG_NOVO" = "boletim-senar:1.1" ]; then
  docker update --restart=no "$NOVO"                  # o NOVO: evita que volte sozinho após reinício
  docker stop "$NOVO"
  docker rm "$NOVO"                                   # só o contêiner cuja imagem é a 1.1
  docker rename "${ANTIGO:?defina no passo 0.1}-1.0-antigo" "$ANTIGO"
  docker update --restart "${POLITICA_ANTIGO:?defina no passo 0.1}" "$ANTIGO"    # restaura a política original (anotada no passo 0.1; se for on-failure, use on-failure:${TENTATIVAS_ANTIGO:?defina no passo 0.1})
  docker start "$ANTIGO"
else
  echo "ATENCAO: o contêiner chamado '$NOVO' NAO e o 1.1 (imagem: '${IMG_NOVO:-inexistente}'). Ele pode ser o antigo 1.0 (o passo 3 falhou antes do 'docker rename'), entao NADA foi removido. Veja abaixo 'Se o guard recusou'."
fi
```

**Se o guard recusou** (o contêiner `$NOVO` não é o 1.1): confira com `docker ps -a --format '{{.Names}}	{{.Image}}	{{.Status}}'`. Se o `1.0` ainda se chama `$ANTIGO` (o passo 3 falhou antes do rename), basta garantir a política e iniciá-lo: `docker update --restart "$POLITICA_ANTIGO" "$ANTIGO"` e `docker start "$ANTIGO"`. Se ele já foi renomeado para `${ANTIGO}-1.0-antigo` e não existe contêiner `$NOVO`, execute só `docker rename "${ANTIGO}-1.0-antigo" "$ANTIGO"`, o `docker update --restart` e o `docker start`. Nunca remova um contêiner cuja imagem não seja `boletim-senar:1.1`.

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

Nada a reverter: as migrações `002_link_publico.sql` e `003_imagens.sql` são aditivas e o banco migrado continua válido para a `1.0` (ela ignora a coluna `token_publico` e a tabela `imagens`); deixe `schema_migrations` como está. **Atenção com as imagens dos blocos:** a `1.0` só conhece os campos de texto dos blocos, então toda edição salva por ela descarta o `dados.imagem` dos blocos. As imagens continuam na tabela `imagens`, mas ficam desligadas dos blocos das edições salvas depois do rollback (e as já publicadas continuam com os PDF/PNG gerados, que levam a imagem). Se a atualização for refeita, as imagens desligadas precisam ser reenviadas no editor. **Não** restaure o dump a menos que haja corrupção comprovada (restaurar apaga o que foi editado depois do backup).

## O que NÃO tocar

- Outros contêineres e suas redes/volumes.
- Outros VirtualHosts, sites habilitados e módulos do Apache (só o `000-default.conf`, nos pontos descritos, e o diretório `/etc/apache2/boletim/`).
- O banco de dados (sem `DROP`, sem recriar, sem editar tabelas manualmente).
- A porta 3100 (e a 3101 de teste) devem continuar só em `127.0.0.1`.
