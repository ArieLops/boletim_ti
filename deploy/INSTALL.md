# Instalação do Comunicado Semanal SENAR-RS (Ubuntu 22.04 / 24.04)

> **AVISO: o que NÃO foi verificado.** Este guia foi escrito e a aplicação testada em Windows. **Nada aqui foi executado em Ubuntu**: unit systemd, site nginx, `backup.sh`, instalação do Chrome/Chromium, permissões e cron não foram testados num servidor real. Só foram verificados no desenvolvimento: a aplicação e seus testes (Node + MariaDB), `GET /saude`, a exportação PDF/PNG contra o Edge (`scripts/smoke-export.js`) e a sintaxe do `backup.sh` (`bash -n`). **Trate a primeira instalação como o teste real** e anote qualquer ajuste necessário. O Passo 10 (teste de fumaça do Chromium) valida a parte mais sensível.

Arquitetura: o Node escuta **somente em 127.0.0.1:3000**; o nginx recebe o HTTPS e repassa. Todos os dados (edições, usuários, logos, arquivos publicados, sessões) ficam no MySQL/MariaDB.

## 0. Pré-requisitos

- Ubuntu 22.04 ou 24.04 com acesso `sudo`.
- MySQL 8 ou MariaDB 10.6+ (local ou remoto).
- Nome DNS interno (ex.: `boletim.senar-rs.com.br`) e certificado HTTPS (CA interna ou Let's Encrypt).
- Node.js 22.12 ou superior (exigido pelo puppeteer-core 25; o NodeSource 22.x atende).
- Cerca de 500 MB livres (Chrome + dependências) e 1 GB de RAM livre para a exportação.

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg nginx mysql-server   # ou mariadb-server; pule o que já existir
```

## 1. Node.js 22.12+ (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v           # deve mostrar v22.12 ou superior
command -v node   # normalmente /usr/bin/node (usado no boletim.service)
```

## 2. Chrome/Chromium para exportar PDF e PNG

**Armadilha do snap:** no Ubuntu, o pacote apt `chromium-browser` é só um atalho para um **snap**. Snap sob systemd, com usuário de serviço sem home, costuma falhar (confinamento, `/run/user`, sandbox). **Não use** o `chromium-browser` do apt/snap. Recomendado: **Google Chrome estável (.deb)**:

```bash
cd /tmp
curl -fsSLO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb   # o apt resolve as dependências
/usr/bin/google-chrome-stable --version
```

Alternativa: um Chromium que não seja snap (pacote .deb de outra fonte aprovada pela TI). Em qualquer caso, informe o caminho em `CHROMIUM_PATH` (Passo 6).

- **Fontes (instale):** o app embute a fonte Inter, mas **só o subconjunto latino** (letras, números, pontuação). Emoji e símbolos como ✅ ⚠️ 📌 → ✓ não estão nela e dependem das fontes do sistema; um servidor sem interface gráfica normalmente não tem nenhuma, e esses caracteres saem como **quadrados vazios** no PDF e nos PNG. Instale:

  ```bash
  sudo apt install -y fonts-noto-color-emoji fonts-noto-core fonts-liberation
  ```

  (`fonts-liberation` costuma vir como dependência do .deb do Chrome; está listada para ficar explícita. O Passo 10 mostra como conferir.)
- **Ubuntu 24.04:** o AppArmor restringe *user namespaces* não privilegiados, o que pode impedir o sandbox do Chrome. O Chrome do .deb costuma trazer seu próprio perfil e funcionar. Se o teste do Passo 10 falhar com mensagens de sandbox/namespace, o **último recurso** é `CHROMIUM_NO_SANDBOX=1` no `boletim.env` (o Chrome roda sem sandbox; aceitável aqui porque só renderiza HTML gerado pelo próprio sistema, mas prefira corrigir o AppArmor se a TI puder). O mesmo vale para contêineres.

## 3. Usuário do sistema e pastas

```bash
sudo useradd --system --home-dir /opt/boletim --shell /usr/sbin/nologin boletim
sudo mkdir -p /opt/boletim /etc/boletim
sudo chown boletim:boletim /opt/boletim
```

## 4. Copiar o código e instalar dependências

O código é enviado como um pacote do `git archive` (só os arquivos versionados e necessários à produção; ficam de fora `docs/`, `tests/`, `.tools`, `.superpowers` e os scripts de desenvolvimento, conforme `.gitattributes`). No Windows não há `rsync`; `git`, `scp` e `tar` bastam. **Commite antes**: o pacote contém apenas o que está no `HEAD`.

Na máquina de desenvolvimento:

```bash
git archive --format=tar.gz -o boletim.tar.gz HEAD
scp boletim.tar.gz usuario@servidor:/tmp/boletim.tar.gz
```

No servidor, extraia primeiro numa pasta de **staging de propriedade do root** (`/usr/local/src/boletim`). O usuário do serviço não consegue alterá-la; dela saem a cópia de produção e o script de backup (Passos 12 e 13):

```bash
sudo apt install -y rsync          # se ainda não existir
sudo rm -rf /usr/local/src/boletim && sudo mkdir -p /usr/local/src/boletim
sudo tar -xzf /tmp/boletim.tar.gz --no-same-owner -C /usr/local/src/boletim
sudo rsync -a --delete --exclude node_modules /usr/local/src/boletim/ /opt/boletim/
sudo chown -R boletim:boletim /opt/boletim
cd /opt/boletim
sudo -u boletim npm ci --omit=dev
```

## 5. Banco de dados

Crie o banco e um usuário dedicado (nunca use o `root` na aplicação). Troque a senha:

```bash
sudo mysql <<'SQL'
CREATE DATABASE boletim CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'boletim'@'localhost' IDENTIFIED BY 'TROQUE-PELA-SENHA-DO-BANCO';
GRANT ALL PRIVILEGES ON boletim.* TO 'boletim'@'localhost';
FLUSH PRIVILEGES;
SQL
```

`ALL PRIVILEGES` **somente sobre `boletim.*`** é necessário porque as migrações e o armazenamento de sessões (`express-mysql-session`) **criam tabelas em tempo de execução** (a tabela `sessions` não vem das migrações). Sem `CREATE` o serviço não sobe ou o login falha.

**`max_allowed_packet` de 16M ou mais** (logos e arquivos publicados são gravados no banco):

```bash
sudo tee /etc/mysql/conf.d/boletim.cnf <<'EOF'
[mysqld]
max_allowed_packet=16M
EOF
sudo systemctl restart mysql      # ou mariadb
mysql -uboletim -p -e "SELECT @@max_allowed_packet/1024/1024 AS MB;"   # deve mostrar 16 ou mais
```

Se o valor não mudar, outro arquivo de configuração o sobrescreve (procure por `max_allowed_packet` em `/etc/mysql`).

## 6. Arquivo de configuração `/etc/boletim/boletim.env`

```bash
sudo cp /opt/boletim/deploy/boletim.env.example /etc/boletim/boletim.env
sudo chown root:boletim /etc/boletim/boletim.env
sudo chmod 640 /etc/boletim/boletim.env
openssl rand -hex 32                 # copie o resultado para SESSION_SECRET
sudo nano /etc/boletim/boletim.env   # DB_PASSWORD, SESSION_SECRET, CHROMIUM_PATH
```

**Regras de valores:** o systemd (`EnvironmentFile`) e o Node (`--env-file`) interpretam o arquivo de formas diferentes. Por isso `DB_PASSWORD` e `SESSION_SECRET` **não podem conter** `#`, aspas, barra invertida (`\`) nem espaços; sem aspas em nenhum valor. A saída de `openssl rand -hex 32` é segura; escolha a senha do banco com letras e números (e símbolos simples como `_ - . @`).

Mantenha `HOST=127.0.0.1` e `COOKIE_SECURE=true` (exige acesso por HTTPS). As migrações rodam sozinhas na subida do serviço.

## 7. Primeiro administrador

A senha é pedida no terminal (não vai em argumento). A troca será exigida no primeiro acesso.

```bash
cd /opt/boletim
sudo -u boletim node --env-file=/etc/boletim/boletim.env scripts/create-admin.js "Nome Sobrenome" login
```

## 8. Serviço systemd

```bash
sudo cp /opt/boletim/deploy/boletim.service /etc/systemd/system/boletim.service
# confira o caminho do node na linha ExecStart (command -v node)
sudo systemctl daemon-reload
sudo systemctl enable --now boletim
systemctl status boletim --no-pager
journalctl -u boletim -n 50 --no-pager      # logs; acompanhar: journalctl -u boletim -f
curl -fsS http://127.0.0.1:3000/saude        # esperado: {"ok":true}
```

## 9. nginx + HTTPS

Primeiro o certificado (o `nginx -t` falha se os arquivos citados não existirem). Use o da CA interna da empresa: copie `fullchain.pem` e `privkey.pem` para `/etc/ssl/boletim/` (chave com modo 600). Para só testar a instalação, gere um certificado autoassinado temporário:

```bash
sudo mkdir -p /etc/ssl/boletim
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=boletim.senar-rs.com.br" \
  -keyout /etc/ssl/boletim/privkey.pem -out /etc/ssl/boletim/fullchain.pem
sudo chmod 600 /etc/ssl/boletim/privkey.pem
```

(Com Let's Encrypt, se o servidor for alcançável pela internet: `sudo apt install certbot python3-certbot-nginx`, ative primeiro só o bloco da porta 80 e rode `sudo certbot --nginx -d boletim.senar-rs.com.br`, que ajusta os caminhos do certificado.) Depois ative o site:

```bash
sudo cp /opt/boletim/deploy/boletim.nginx.conf /etc/nginx/sites-available/boletim
sudo nano /etc/nginx/sites-available/boletim    # server_name e caminhos do certificado
sudo ln -s /etc/nginx/sites-available/boletim /etc/nginx/sites-enabled/boletim
sudo nginx -t && sudo systemctl reload nginx
```

O nginx **precisa** repassar `X-Forwarded-For` (acrescentando) e `X-Forwarded-Proto`: o cookie seguro e o limitador de tentativas de login dependem deles; o arquivo de exemplo já faz isso.

### Se o Apache já ocupa as portas 80/443

Opção A: nginx em outra porta (ex.: `listen 8443 ssl;`, ajustando o redirecionamento). Opção B: Apache como proxy reverso, sem nginx:

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
```

```apache
<VirtualHost *:443>
    ServerName boletim.senar-rs.com.br
    SSLEngine on
    SSLCertificateFile    /etc/ssl/boletim/fullchain.pem
    SSLCertificateKeyFile /etc/ssl/boletim/privkey.pem
    LimitRequestBody 5242880
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass        / http://127.0.0.1:3000/ timeout=90
    ProxyPassReverse / http://127.0.0.1:3000/
    # O mod_proxy já acrescenta X-Forwarded-For com o IP do cliente.
</VirtualHost>
```

## 10. Validar o Chromium (teste de fumaça)

```bash
sudo -u boletim mkdir -p /tmp/smoke
cd /opt/boletim
sudo -u boletim node --env-file=/etc/boletim/boletim.env scripts/smoke-export.js /tmp/smoke
```

Esperado: três linhas `PASS` (PDF com 1 página, PNG de e-mail 1240x1754, PNG de WhatsApp com largura 1080) e `RESULTADO: PASS` (código de saída 0). Abra o PDF (`comunicado-smoke.pdf`) e o PNG (`comunicado-smoke-email.png`) e procure, no fim do bloco de dica, a linha **"Teste de glifos: ✅ ⚠️ 📌 → ✓"**: ela deve mostrar ícones; se aparecerem quadrados vazios, as fontes do Passo 2 não foram instaladas (ou o Chrome precisa ser reiniciado depois de instalá-las). O resultado PASS/FAIL do script não avalia isso: a conferência é visual. Em caso de `FAIL`:

1. "Navegador ... não encontrado": corrija `CHROMIUM_PATH` (`ls -l` no caminho; não pode ser o atalho do snap).
2. Erro mencionando sandbox/namespace/"No usable sandbox": no Ubuntu 24.04 veja o Passo 2; como último recurso adicione `CHROMIUM_NO_SANDBOX=1` ao `boletim.env` e rode de novo.
3. Biblioteca ausente (`error while loading shared libraries`): reinstale o `.deb` com `sudo apt install -y ./google-chrome-stable_current_amd64.deb` ou instale a biblioteca citada.
4. Repita também sob o systemd (o ambiente difere do seu shell): `sudo systemctl restart boletim`, entre no sistema, publique uma edição de teste e baixe os 3 arquivos.

## 11. Verificação final

- `https://boletim.senar-rs.com.br` abre; login do administrador; troca de senha.
- Criar edição, publicar, baixar PDF, PNG de e-mail e PNG de WhatsApp. **Use um número descartável alto (ex.: 999) no campo "Número" da nova edição**, para que a primeira edição de verdade possa ser a 001. Ao terminar, apague a edição de teste (blocos, histórico e arquivos publicados vão junto, por `ON DELETE CASCADE`):

  ```bash
  sudo mysql boletim -e "DELETE FROM edicoes WHERE numero=999;"
  sudo mysql boletim -e "SELECT numero, titulo FROM edicoes;"    # confira: a de teste não aparece mais
  ```

  Se você criou a de teste com o número sugerido (001) em vez de 999, apague-a do mesmo jeito (`numero=1`) antes de usar o sistema de verdade.
- `sudo systemctl restart boletim` e confirmar que os dados continuam.
- De outro computador, `http://IP-DO-SERVIDOR:3000` **não** deve responder (o Node só escuta em localhost).

## 12. Backup diário e restauração

Credenciais do backup (somente root):

```bash
sudo tee /etc/boletim/backup.cnf <<'EOF'
[client]
user=boletim
password=TROQUE-PELA-SENHA-DO-BANCO
EOF
sudo chown root:root /etc/boletim/backup.cnf && sudo chmod 600 /etc/boletim/backup.cnf   # root:root 600
# Cópia de propriedade do root, instalada a partir do STAGING do root (Passo 4), nunca de /opt/boletim:
# o cron roda como root e não deve executar um arquivo que o usuário do serviço (boletim) possa alterar.
# Refaça este comando sempre que o backup.sh mudar (Passo 13); antes, compare: diff /usr/local/src/boletim/deploy/backup.sh /usr/local/sbin/boletim-backup
sudo install -o root -g root -m 700 /usr/local/src/boletim/deploy/backup.sh /usr/local/sbin/boletim-backup
sudo /usr/local/sbin/boletim-backup        # teste manual; deve imprimir "OK ..."
ls -l /var/backups/boletim/
```

Cron diário às 02:30 (como root). O cron envia por e-mail qualquer saída, então o script só escreve quando há erro (ou a linha "OK"; se preferir silêncio, redirecione a saída padrão para `/dev/null`, como abaixo, e erros continuam chegando por stderr):

```bash
echo '30 2 * * * root /usr/local/sbin/boletim-backup >/dev/null' | sudo tee /etc/cron.d/boletim-backup
```

Os arquivos têm retenção de 28 dias. **Copie `/var/backups/boletim` para outra máquina**: backup no mesmo servidor não protege contra a perda do servidor.

Restauração: **teste primeiro num banco descartável**.

```bash
sudo mysql -e "CREATE DATABASE boletim_teste CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gunzip -c /var/backups/boletim/boletim-AAAAMMDD-HHMM.sql.gz | sudo mysql boletim_teste
sudo mysql boletim_teste -e "SELECT COUNT(*) FROM edicoes;"   # confira que há dados
sudo mysql -e "DROP DATABASE boletim_teste;"
```

Restauração real (sobrescreve os dados atuais):

```bash
sudo systemctl stop boletim
gunzip -c /var/backups/boletim/boletim-AAAAMMDD-HHMM.sql.gz | sudo mysql boletim
sudo systemctl start boletim
```

## 13. Atualização

Faça um backup antes e envie a nova versão do mesmo modo do Passo 4 (pacote `git archive` extraído no staging do root; `node_modules` do servidor é preservado):

```bash
sudo /usr/local/sbin/boletim-backup
# na máquina de desenvolvimento (com tudo commitado):
git archive --format=tar.gz -o boletim.tar.gz HEAD
scp boletim.tar.gz usuario@servidor:/tmp/boletim.tar.gz
# no servidor (guarde a versão anterior para reversão):
sudo rsync -a --exclude node_modules /opt/boletim/ /opt/boletim.anterior/
sudo rm -rf /usr/local/src/boletim && sudo mkdir -p /usr/local/src/boletim
sudo tar -xzf /tmp/boletim.tar.gz --no-same-owner -C /usr/local/src/boletim
sudo rsync -a --delete --exclude node_modules /usr/local/src/boletim/ /opt/boletim/
sudo chown -R boletim:boletim /opt/boletim
cd /opt/boletim
sudo -u boletim npm ci --omit=dev
# refaz a cópia do backup a partir do staging do root (veja antes o que mudou):
diff /usr/local/src/boletim/deploy/backup.sh /usr/local/sbin/boletim-backup || true
sudo install -o root -g root -m 700 /usr/local/src/boletim/deploy/backup.sh /usr/local/sbin/boletim-backup
# se deploy/boletim.service ou o site nginx mudaram, copie-os de novo (Passos 8 e 9); para o service: sudo systemctl daemon-reload
sudo systemctl restart boletim
journalctl -u boletim -n 20 --no-pager
curl -fsS http://127.0.0.1:3000/saude
```

As migrações rodam automaticamente na subida; os dados não são apagados. **Reversão:** `sudo rsync -a --delete --exclude node_modules /opt/boletim.anterior/ /opt/boletim/`, depois `cd /opt/boletim && sudo -u boletim npm ci --omit=dev` e `sudo systemctl restart boletim`. Migrações já aplicadas não são desfeitas; para voltar o banco use a restauração do Passo 12.

## 14. Solução de problemas

| Sintoma | Causa provável / ação |
|---|---|
| Publicar/exportar retorna 503 ("exportação indisponível"; log com `ExportUnavailableError`) | Chromium não encontrado ou não abre. Confira `CHROMIUM_PATH`, rode o Passo 10, veja `journalctl -u boletim`. Evite o snap. |
| Chromium reclama de sandbox | Ubuntu 24.04/AppArmor ou contêiner: `CHROMIUM_NO_SANDBOX=1` (último recurso). |
| Serviço não sobe: `FATAL: Configuração incompleta` | Falta variável em `/etc/boletim/boletim.env` (a mensagem diz qual). |
| Serviço não sobe: `ER_ACCESS_DENIED_ERROR` ou `CREATE command denied` | Usuário do banco sem os privilégios do Passo 5. |
| Login não "fixa" (volta para a tela de login) | `COOKIE_SECURE=true` com acesso por HTTP, ou proxy sem `X-Forwarded-Proto`. Use HTTPS. |
| Usuário bloqueado por tentativas de login | O bloqueio fica em memória: `sudo systemctl restart boletim` zera. |
| Todos foram deslogados | `SESSION_SECRET` foi trocado ou as sessões expiraram; é esperado. |
| `ER_NET_PACKET_TOO_LARGE` ao publicar ou enviar logo | `max_allowed_packet` baixo no servidor do banco (Passo 5). |
| 413 ao enviar logo | `client_max_body_size` do nginx (ou `LimitRequestBody` do Apache) abaixo de 5m. |
| Backup falha com `Access denied ... RELOAD`, `FLUSH_TABLES` ou `PROCESS` (algumas versões 8.0.x) | Conceda só o privilégio que a mensagem cita ao usuário de backup (`boletim`), nunca ao root: por exemplo `GRANT RELOAD ON *.* TO 'boletim'@'localhost';` (ou `FLUSH_TABLES`/`PROCESS`). O script já usa `--no-tablespaces`, que evita o PROCESS na maioria dos casos. |
| 502 Bad Gateway | Serviço parado: `systemctl status boletim` e `curl http://127.0.0.1:3000/saude`. |

## 15. Checklist de segurança

- [ ] Node escuta só em `127.0.0.1` (`HOST=127.0.0.1`); `ss -tlnp | grep 3000` mostra `127.0.0.1:3000`.
- [ ] Acesso somente por HTTPS; `COOKIE_SECURE=true`.
- [ ] Senha forte para o administrador, trocada no primeiro acesso.
- [ ] Usuário do banco dedicado (privilégios só em `boletim.*`); nunca `root`.
- [ ] `/etc/boletim/boletim.env` com modo 640 (`root:boletim`) e `/etc/boletim/backup.cnf` com modo 600.
- [ ] Backups copiados para fora do servidor e restauração testada.
- [ ] Atualizações de segurança do Ubuntu e do Chrome em dia.
