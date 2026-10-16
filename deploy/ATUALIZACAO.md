# Atualização e Rollback em produção (publicação em `/boletim_ti/`)

Procedimento para passar do `boletim-senar:1.0` (raiz do servidor/porta 3100) para o `boletim-senar:1.1` (com `BASE_PATH=/boletim_ti`) atrás do Apache, e como voltar atrás. Detalhes em [docker/README.md](docker/README.md) e [apache/README.md](apache/README.md).

> **Aviso de validação:** nenhum destes passos foi executado numa máquina com Docker ou Apache (a máquina de desenvolvimento não tem nenhum dos dois). Os comandos foram escritos e revisados com cuidado, mas o primeiro `docker build`, o primeiro `apachectl configtest` e o smoke test do Chromium acontecerão em produção. Siga a ordem e os pontos de parada.

## Princípios

- **Ordem segura: aplicação antes do Apache.** Primeiro o novo contêiner é validado direto em `127.0.0.1:3100`; só então o Apache é alterado.
- **Não toque** em outros contêineres, em outros VirtualHosts/sites do Apache, nem no banco (nenhum `DROP`/recriação). As migrações do app são idempotentes e aditivas: subir a versão nova não exige operação manual no banco.
- Cada etapa tem validação; se falhar, pare e vá para o Rollback (a imagem `1.0` e o contêiner antigo permanecem intactos até o fim).
- Janela de indisponibilidade: apenas o tempo entre parar o contêiner antigo e o novo ficar saudável (≈ 1 min).
- Sessões: o cookie passa de `sid` para `boletim.sid` (com `Path=/boletim_ti`). Sessões antigas simplesmente expiram; os usuários precisam entrar de novo uma vez. Nenhum dado é perdido.

## Atualização

### 0. Preparação (sem impacto)

```bash
cd /opt/boletim_ti
git status                      # deve estar limpo
git fetch --all --tags
git branch --show-current       # anote: branch/tag atual (para o rollback do código)
git rev-parse --short HEAD
```

Backup do banco (precaução; as migrações não são destrutivas). As credenciais vêm de um arquivo de opções, **não** na linha de comando. Crie-o uma vez, com modo `600`, e apague depois se quiser:

```bash
# /root/.boletim-dump.cnf  (chmod 600)
# [client]
# user=<usuario-do-banco>
# password=<senha-do-banco>
# host=127.0.0.1
sudo install -m 600 /dev/null /root/.boletim-dump.cnf && sudo nano /root/.boletim-dump.cnf

sudo mkdir -p /root/backups-boletim
sudo mysqldump --defaults-extra-file=/root/.boletim-dump.cnf --single-transaction --routines <nome-do-banco> \
  | gzip > /root/backups-boletim/boletim-$(date +%Y%m%d-%H%M%S).sql.gz
ls -l /root/backups-boletim/       # confirme que o arquivo não está vazio
```

Registre a configuração do contêiner antigo para reproduzir (os valores são sensíveis: grave num arquivo `600`, não cole em chamados):

```bash
sudo sh -c 'umask 077; docker inspect boletim > /root/boletim-1.0-inspect.json'
docker ps --filter name=boletim --format '{{.Image}} {{.Ports}} {{.Status}}'   # esperado: boletim-senar:1.0 127.0.0.1:3100->3000/tcp
```

Crie/ajuste `/etc/boletim/boletim.env` (modo `600`) com as variáveis descritas em [docker/README.md](docker/README.md) (`DB_*` e `SESSION_SECRET` iguais aos do contêiner antigo, mais `COOKIE_SECURE=false`, `BASE_PATH=/boletim_ti`, e `CHROMIUM_NO_SANDBOX=1` se necessário).

### 1. Obter o código e construir a imagem

```bash
cd /opt/boletim_ti
git checkout <branch-ou-tag-indicado>      # ex.: feat/base-path ou a tag da versão
git pull --ff-only                         # se for um branch
docker build -t boletim-senar:1.1 .
docker images boletim-senar                # 1.0 e 1.1 devem aparecer
```

Validação: o build termina sem erro. **Não** remova a `1.0`.

### 2. Testar o Chromium da imagem nova (portão)

Sem tocar no contêiner em produção:

```bash
docker run --rm -e CHROMIUM_NO_SANDBOX=1 boletim-senar:1.1 node scripts/smoke-export.js /tmp/smoke
```

Esperado: todas as linhas `PASS` e saída 0. O `chromium` do Debian é mais antigo que o Chrome-alvo do `puppeteer-core` 25 (não foi testado na máquina de desenvolvimento). **Se falhar, pare aqui** (nada foi alterado em produção).

### 3. Trocar o contêiner (aplicação)

```bash
docker stop boletim
docker rename boletim boletim-1.0-antigo          # mantém o antigo parado, para o rollback
docker run -d --name boletim --restart unless-stopped \
  -p 127.0.0.1:3100:3000 --env-file /etc/boletim/boletim.env boletim-senar:1.1
```

Validação (direto no contêiner, ainda sem Apache):

- [ ] `docker ps --filter name=boletim` mostra `boletim-senar:1.1`, `Up` e, após ~30 s, `(healthy)`
- [ ] `docker logs --tail 50 boletim` sem erros
- [ ] `curl -i http://127.0.0.1:3100/saude` → `200 {"ok":true}`
- [ ] `curl -i http://127.0.0.1:3100/boletim_ti/saude` → `200`
- [ ] `curl -i http://127.0.0.1:3100/boletim_ti/login` → `200` com `Set-Cookie: boletim.sid=...; Path=/boletim_ti`
- [ ] Fluxo de login no navegador via `http://127.0.0.1:3100/boletim_ti/` (túnel SSH: `ssh -L 3100:127.0.0.1:3100 usuario@192.168.10.161`, depois abrir `http://127.0.0.1:3100/boletim_ti/`): entrar, abrir uma edição, publicar e baixar PDF/PNG

Se algo falhar: Rollback, seção "Só a aplicação".

### 4. Apache (somente depois da aplicação validada)

Siga [apache/README.md](apache/README.md): conferir `grep -RIn "ProxyPass" /etc/apache2/`, backup datado de `000-default.conf`, copiar o snippet, **preencher a faixa autorizada** (`FAIXA_AUTORIZADA_AQUI`), adicionar a `RewriteCond` de exceção e o `IncludeOptional`, `sudo apachectl configtest`, `sudo systemctl reload apache2`.

Validação (matriz completa no README do Apache):

- [ ] `curl -i http://192.168.10.161/boletim_ti/` → `302` para `/boletim_ti/login` (sem HTTPS)
- [ ] `curl -i http://192.168.10.161/boletim_ti` → `301` para `/boletim_ti/`
- [ ] Login pelo navegador em `http://192.168.10.161/boletim_ti/`, exportação OK
- [ ] De fora da faixa autorizada → `403`
- [ ] Um outro sistema do servidor segue redirecionando HTTP→HTTPS como antes

### 5. Depois

- Se tudo certo, mantenha `boletim-1.0-antigo` parado e a imagem `1.0` por alguns dias. Quando decidir descartar: `docker rm boletim-1.0-antigo` (apenas ele).
- Agende a migração para HTTPS (`a2enmod headers`, `Include` no `:443`, `COOKIE_SECURE=true`). Enquanto for HTTP, as credenciais trafegam em texto claro na rede interna.

## Rollback

Reverta na **ordem inversa**: primeiro o Apache, depois a aplicação.

### Apache (se já foi alterado)

1. Restaurar o backup: `sudo cp -a /root/apache-backups/000-default.conf.<DATA> /etc/apache2/sites-enabled/000-default.conf` (ou remover a `RewriteCond` de exceção e o `IncludeOptional`).
2. `sudo apachectl configtest` → `Syntax OK`
3. `sudo systemctl reload apache2`
4. Conferir que os outros sistemas seguem normais (HTTP→HTTPS intacto).

### Só a aplicação (voltar ao `boletim-senar:1.0`)

```bash
docker stop boletim && docker rm boletim                 # o NOVO (1.1)
docker rename boletim-1.0-antigo boletim
docker start boletim
```

Se o contêiner antigo não existir mais, suba um novo da imagem `1.0` com a configuração anterior (valores em `/root/boletim-1.0-inspect.json`):

```bash
docker run -d --name boletim --restart unless-stopped \
  -p 127.0.0.1:3100:3000 --env-file <env-file-ou-variaveis-anteriores> boletim-senar:1.0
```

Validação do rollback:

- [ ] `docker ps --filter name=boletim` mostra `boletim-senar:1.0`, `Up`
- [ ] `curl -i http://127.0.0.1:3100/saude` → `200`
- [ ] Login funcionando como antes (sessões do cookie `sid` antigo podem ter expirado: o usuário apenas entra de novo)
- [ ] Código: `cd /opt/boletim_ti && git checkout <branch-ou-tag-anotado-na-preparacao>`

### Banco

Nada a reverter: as migrações são idempotentes e aditivas, e o schema existente continua sendo usado pela `1.0` (confirme no log de migração se houve alguma mudança de schema na versão atualizada). **Não** restaure o dump a menos que haja corrupção comprovada (restaurar apaga o que foi editado depois do backup).

## O que NÃO tocar

- Outros contêineres e suas redes/volumes.
- Outros VirtualHosts, sites habilitados e módulos do Apache (só o `000-default.conf`, nos pontos descritos, e o diretório `/etc/apache2/boletim/`).
- O banco de dados (sem `DROP`, sem recriar, sem editar tabelas manualmente).
- A porta 3100 deve continuar só em `127.0.0.1`.
