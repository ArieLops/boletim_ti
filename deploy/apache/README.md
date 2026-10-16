# Apache: publicar em `http://192.168.10.161/boletim_ti/`

Guia para o operador colocar o Comunicado Semanal atrás do Apache2 que já atende o servidor, no subdiretório `/boletim_ti/`. O aplicativo roda em Docker (veja [../docker/README.md](../docker/README.md)) publicado só em `127.0.0.1:3100`; o Apache faz o proxy e restringe quem pode acessar.

> **O que NÃO foi validado:** nenhum destes arquivos foi aplicado nem testado contra um Apache real. A máquina de desenvolvimento não tem Apache (`apachectl`/`apache2ctl`); a sintaxe foi revisada contra a documentação do Apache 2.4 e há testes estáticos em `tests/deploy-files.test.js`. O primeiro `apachectl configtest` real será o seu. Faça tudo na ordem abaixo, com backup, e use `reload` (não `restart`).

Arquivo do snippet: [boletim_ti.conf](boletim_ti.conf).

## 1. Pré-requisitos

- Módulos ativos (já estão): `proxy_module`, `proxy_http_module`, `rewrite_module`, `ssl_module`. Confira: `apache2ctl -M | grep -E 'proxy|rewrite|headers|alias'`
- `alias_module` (`RedirectMatch`) é padrão no Ubuntu.
- `headers_module` **não é necessário na fase HTTP**. O snippet só usa `RequestHeader` dentro de `<IfModule mod_headers.c>`, então o `configtest` passa sem ele. **É pré-requisito da fase HTTPS:** `sudo a2enmod headers` (o app precisa do `X-Forwarded-Proto: https` para aceitar o cookie `secure` com `COOKIE_SECURE=true`).
- O contêiner `boletim` no ar e respondendo em `127.0.0.1:3100` (valide antes: `curl -i http://127.0.0.1:3100/boletim_ti/login`).
- A(s) rede(s) autorizada(s) em mãos (por exemplo `192.168.10.0/24`).

## 2. Ordem do ProxyPass (primeiro que casa vence)

O `ProxyPass /boletim_ti/ ...` deve ser avaliado **antes** de qualquer `ProxyPass /` ou `ProxyPassMatch` mais amplo de outros sistemas. Procure por conflitos antes de aplicar:

```bash
grep -RIn "ProxyPass" /etc/apache2/
```

Se algum outro site tem `ProxyPass /` (ou um `ProxyPassMatch` que casa `/boletim_ti`) **no mesmo VirtualHost**, coloque o `Include` deste snippet acima dele. Se estiver em outro VirtualHost (outro `ServerName`/porta), não há conflito.

## 3. A mudança mínima na regra global HTTP→HTTPS

O `000-default.conf` hoje tem, no VirtualHost `:80`, a regra global:

```apache
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

Troque por (apenas uma linha nova entre o `RewriteCond` e o `RewriteRule`):

```apache
RewriteCond %{HTTPS} !=on
RewriteCond %{REQUEST_URI} !^/boletim_ti(/|$)
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

Várias `RewriteCond` seguidas são combinadas com **E**: a regra só dispara se a conexão não é HTTPS **e** o caminho não é `/boletim_ti` (nem `/boletim_ti/...`). Todos os outros sites continuam sendo redirecionados para HTTPS exatamente como hoje.

**Por que precisa ser uma condição nessa regra:** o `mod_rewrite` em contexto de servidor/VirtualHost roda na fase de tradução de URL, **antes** do `mod_proxy`. Sem a exceção, o `301` para HTTPS dispara primeiro (`[L,R=301]`) e o proxy nunca chega a ver a requisição; o navegador seria jogado para `https://.../boletim_ti/`, onde ainda não há nada. Não dá para resolver só com `ProxyPass` ou `Location`: o rewrite já respondeu antes.

Observações:

- `RewriteEngine On` já deve estar ativo nesse VirtualHost (a regra atual depende dele). Não adicione outro `RewriteEngine`.
- Na fase HTTPS (`:443`), a regra não se aplica (a conexão já é HTTPS); o `Include` do snippet entra também no `:443` e a exceção pode ser mantida ou removida depois que o app for servido só por HTTPS.
- O redirect `/boletim_ti` → `/boletim_ti/` usa `RedirectMatch` (mod_alias), e não `RewriteRule`, justamente para **não** mexer na regra global de `mod_rewrite`. Com a exceção acima, o `/boletim_ti` sem barra passa pela regra global sem ser capturado e cai no `RedirectMatch`.

## 4. Onde colocar o `Include` e por que um diretório dedicado

Escolha adotada: copiar o snippet para um **diretório dedicado fora de `sites-enabled`/`conf-enabled`** e referenciá-lo com `IncludeOptional` **dentro do VirtualHost**. Motivo: o snippet precisa ficar dentro do VirtualHost (vale a ordem das diretivas e o `RedirectMatch`/`Location` aplicam ao vhost certo), o que `conf-enabled` (carregado em contexto global) não garante; e um diretório dedicado evita que o arquivo seja carregado duas vezes ou no contexto errado. (`IncludeOptional` com caminho inexistente não derruba o Apache; durante a reversão isso ajuda. Se você prefere falha explícita quando o arquivo some, use `Include`.)

Dentro do `<VirtualHost *:80>` de `000-default.conf`, **antes** de outras regras de proxy:

```apache
    # Comunicado Semanal (SENAR-RS) em /boletim_ti
    IncludeOptional /etc/apache2/boletim/boletim_ti.conf
```

Mais tarde, quando existir o `<VirtualHost *:443>`, repita a mesma linha dentro dele (o mesmo arquivo serve aos dois).

## 5. Como aplicar

No servidor, como root (ou com `sudo`), a partir de `/opt/boletim_ti`:

```bash
# 1) Backup datado, fora de sites-enabled (guarde o nome para a reversão)
sudo mkdir -p /root/apache-backups
sudo cp -a /etc/apache2/sites-enabled/000-default.conf /root/apache-backups/000-default.conf.$(date +%Y%m%d-%H%M%S)
ls -l /root/apache-backups/

# 2) Copiar o snippet para o diretório dedicado
sudo mkdir -p /etc/apache2/boletim
sudo cp deploy/apache/boletim_ti.conf /etc/apache2/boletim/boletim_ti.conf

# 3) Preencher a faixa autorizada (troque FAIXA_AUTORIZADA_AQUI)
sudo nano /etc/apache2/boletim/boletim_ti.conf
#    Exemplo:  Require ip 192.168.10.0/24

# 4) Editar 000-default.conf: a RewriteCond de exceção (seção 3) e o IncludeOptional (seção 4)
sudo nano /etc/apache2/sites-enabled/000-default.conf

# 5) Testar a sintaxe. DEVE dizer "Syntax OK"
sudo apachectl configtest

# 6) Recarregar (reload não derruba conexões; não use restart)
sudo systemctl reload apache2
```

**O placeholder `FAIXA_AUTORIZADA_AQUI` faz o `configtest` falhar de propósito** (`Require ip` com argumento que não é IP/rede é erro de sintaxe). Isso impede de publicar o app aberto a todos por esquecimento: se o passo 5 reclamar de `Require`, falta o passo 3. Nunca contorne removendo a linha `Require`: sem ela o acesso fica livre.

Se o `configtest` falhar, **não recarregue**; corrija ou reverta (seção 8). O Apache em execução continua com a configuração antiga enquanto você não fizer o `reload`.

## 6. Validação (matriz de `curl -i`)

Execute **de uma máquina dentro da faixa autorizada** (e uma vez de fora, linha 7). Troque o IP se necessário.

| # | Comando | Esperado |
|---|---------|----------|
| 1 | `curl -i http://192.168.10.161/boletim_ti/` | `302` com `Location: /boletim_ti/login` (sem sessão). Não é redirecionado para HTTPS |
| 2 | `curl -i http://192.168.10.161/boletim_ti` | `301` com `Location: http://192.168.10.161/boletim_ti/` |
| 3 | `curl -i http://192.168.10.161/boletim_ti/login` | `200` e `Set-Cookie: boletim.sid=...; Path=/boletim_ti; HttpOnly; SameSite=Lax` (sem `Secure` enquanto `COOKIE_SECURE=false`) |
| 4 | `curl -i http://192.168.10.161/boletim_ti/app.css` | `200`, `Content-Type: text/css` |
| 5 | `curl -i http://192.168.10.161/boletim_ti/saude` | `200` com `{"ok":true}` |
| 6 | `curl -i http://192.168.10.161/<caminho de outro sistema existente>` | **Inalterado**: continua `301` para HTTPS como antes |
| 7 | (de fora da faixa) `curl -i http://192.168.10.161/boletim_ti/login` | `403 Forbidden` |
| 8 | `curl -i http://192.168.10.161/login` e `.../api/configuracoes` | **Não** são do Boletim: respondem o que o outro site/servidor responde hoje (redirecionamento para HTTPS, 404 etc.). Se aparecer a tela do Boletim aqui, o proxy está amplo demais: revise o snippet |

No navegador: abra `http://192.168.10.161/boletim_ti/`, faça login, edite, publique e baixe o PDF/PNG (a exportação usa o `timeout=90`).

Se a linha 1 devolver `301` para `https://`, a exceção da seção 3 não está valendo (confira a ordem das `RewriteCond` e se editou o vhost certo).

### Inspecionar ordem e VirtualHosts

```bash
sudo apachectl -S                      # vhosts, ServerName, arquivo/linha de cada um
sudo apachectl -t -D DUMP_VHOSTS       # idem, só os vhosts
sudo apache2ctl -M | grep -E 'proxy|rewrite|headers'
grep -RIn "ProxyPass" /etc/apache2/    # todos os ProxyPass (quem aparece primeiro no vhost vence)
grep -RIn "RewriteRule\|RewriteCond" /etc/apache2/sites-enabled/
```

## 7. Fase HTTPS (quando existir)

1. `sudo a2enmod headers` e `sudo systemctl reload apache2`.
2. Colocar o mesmo `IncludeOptional` dentro do `<VirtualHost *:443>`.
3. No `/etc/boletim/boletim.env` trocar `COOKIE_SECURE=false` para `true` e recriar o contêiner (docker não relê o env-file em `restart`; veja o guia do Docker).
4. Validar `curl -ik https://192.168.10.161/boletim_ti/login`: `Set-Cookie` com `Secure` e `Path=/boletim_ti`.

## 8. Reverter

1. Restaurar o backup de `000-default.conf` feito na seção 5 (ou remover manualmente a `RewriteCond` de exceção e a linha `IncludeOptional`):
   `sudo cp -a /root/apache-backups/000-default.conf.<DATA> /etc/apache2/sites-enabled/000-default.conf`
2. (Opcional) remover o snippet: `sudo rm /etc/apache2/boletim/boletim_ti.conf`
3. `sudo apachectl configtest` (deve dar `Syntax OK`)
4. `sudo systemctl reload apache2`
5. Conferir que os outros sites seguem normais (linha 6 da matriz).

A reversão do Apache **não mexe** no contêiner nem no banco.

## 9. Avisos

- **Firewall local inativo:** a linha `Require ip` é o **único** controle de rede deste sistema. Não a remova nem a amplie para `all granted`.
- **HTTP expõe credenciais na rede interna:** login e cookie trafegam em texto claro. Use apenas na rede interna autorizada e migre para HTTPS (e `COOKIE_SECURE=true`) o quanto antes.
- **Nunca exponha a porta 3100 além de `127.0.0.1`.** O contêiner deve ser publicado como `-p 127.0.0.1:3100:3000`. Confira: `ss -ltnp | grep 3100` deve mostrar `127.0.0.1:3100`, não `0.0.0.0:3100`.
- Não altere outros VirtualHosts, sites habilitados nem módulos além do descrito aqui.
