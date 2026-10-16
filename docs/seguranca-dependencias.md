# Segurança das dependências

Registro da correção dos alertas do `npm audit` (16/10/2026). Nenhum `--force` foi usado.

## 1. Baseline (antes)

`npm audit --omit=dev` e `npm audit` davam o mesmo resultado: **9 vulnerabilidades (1 moderada, 8 altas)**, todas transitivas de duas dependências diretas (`puppeteer-core@24.43.1` e `express-mysql-session@3.0.3`).

Sugestões do `npm audit fix --force`: `puppeteer-core@25.14.0` (major, aceita) e `express-mysql-session@2.1.8` (**downgrade, rejeitada**; a correção foi um override, ver abaixo).

## 2. Os 9 alertas

| # | Pacote | Severidade | Advisory | Caminho | Alcançável em produção? |
|---|--------|-----------|----------|---------|-------------------------|
| 1 | `puppeteer-core` 19.8.4 - 24.43.1 | alta | herdado dos itens abaixo | direta | Só como carregador do alerta; o código afetado está nas dependências abaixo |
| 2 | `@puppeteer/browsers` | alta | herdado (extract-zip, proxy-agent) | puppeteer-core > @puppeteer/browsers | Não. Só é usado para baixar/descompactar navegadores; usamos o Chromium do sistema via `executablePath` |
| 3 | `extract-zip` | alta | GHSA-jmr9-qjv8-65gv (symlink path traversal), GHSA-7pqw-9j4j-h8q3 (escrita arbitrária via symlink) | ... > @puppeteer/browsers > extract-zip | Não. Nunca baixamos nem extraímos zips de navegador |
| 4 | `proxy-agent` | alta | herdado | ... > @puppeteer/browsers > proxy-agent | Não. Sem download de navegador e sem proxy configurado |
| 5 | `pac-proxy-agent` | alta | herdado | ... > proxy-agent > pac-proxy-agent | Não. Sem PAC |
| 6 | `get-uri` | alta | herdado | ... > pac-proxy-agent > get-uri | Não. Sem PAC/FTP |
| 7 | `basic-ftp` <= 6.2.0 | alta | GHSA-c475-qrg2-pj4r (DoS quadrático em `Client.list()`) | ... > get-uri > basic-ftp | Não. Nenhum acesso FTP |
| 8 | `mysql2` <= 3.23.0 (cópia aninhada 3.10.2) | alta | GHSA-3f6p-5ww8-9rcr (downgrade para `mysql_clear_password` vaza credenciais), GHSA-rgwj-5xj2-c3m3 (decompression bomb no protocolo comprimido) | express-mysql-session > mysql2 | Não na prática: o código entrega o pool do `mysql2` direto (3.24.6, já corrigido) ao `MySQLStore`, então a cópia aninhada não era carregada. Corrigido mesmo assim para ter uma só versão |
| 9 | `express-mysql-session` >= 3.0.0 | moderada | herdado do mysql2 aninhado | direta | Idem item 8 |

## 3. Correção aplicada

- `puppeteer-core` `^24.43.1` -> `^25.14.0`. A nova versão não traz mais `extract-zip`, `proxy-agent`, `pac-proxy-agent`, `get-uri` nem `basic-ftp` (saíram da árvore, não só foram atualizados). Nenhuma alteração em `src/export/exporter.js` foi necessária.
- `engines.node`: `>=20` -> `>=22.12.0` (exigência do `puppeteer-core` 25 e de `@puppeteer/browsers`). A produção usa Node 22 (imagem `node:22`). Conferido no lockfile: nenhuma dependência exige mais que 22.12 (`chromium-bidi` aceita `>=20.19 <22 || >=22.12`; `yargs` `^20.19 || ^22.12 || >=23`).
- Override em `package.json`:

  ```json
  "overrides": { "express-mysql-session": { "mysql2": "$mysql2" } }
  ```

  `$mysql2` referencia a versão da dependência direta (`^3.24.6`), então `express-mysql-session` passa a usar o mesmo `mysql2` corrigido (hoje 3.24.6, uma única cópia).
  Observação: só editar o `package.json` e rodar `npm install` não remove a cópia antiga já travada no lock; foi preciso `npm uninstall express-mysql-session && npm install express-mysql-session@^3.0.3` para o npm resolver de novo a subárvore com o override (sem editar o lock à mão).

## 4. Resultado (depois)

`npm audit --omit=dev` e `npm audit`: **found 0 vulnerabilities**.

```
express-mysql-session@3.0.3
`-- mysql2@3.24.6 deduped
mysql2@3.24.6
puppeteer-core@25.14.0
```

Regressão: `npm test` com 283 testes passando (inclui exportador real e store de sessão MySQL); `node scripts/smoke-export.js` PASS (PDF 1 página, PNG e-mail 1240x1754, PNG WhatsApp largura 1080).

## 5. Quando remover o override e o que acompanhar

- Remover o `overrides` quando o `express-mysql-session` publicar versão cuja dependência `mysql2` já seja >= 3.24 (confirme com `npm view express-mysql-session dependencies`). Depois, `npm install` e `npm ls mysql2` devem continuar mostrando uma só versão.
- Rodar `npm audit` periodicamente (por exemplo a cada deploy) e atualizar dentro dos intervalos semver.
- Manter o Node de produção em 22.12 ou superior (a imagem `node:22` já satisfaz). Máquinas de desenvolvimento com Node < 22.12 passam a receber aviso de engines.
- Testar o Chromium do servidor com `scripts/smoke-export.js` após atualizações do `puppeteer-core`, pois ele fala com o navegador por protocolo versionado.

## 6. Reproduzir

```
npm audit --omit=dev
npm audit
npm install puppeteer-core@^25.14.0
# editar package.json: engines.node ">=22.12.0" e o bloco "overrides" acima
npm uninstall express-mysql-session && npm install express-mysql-session@^3.0.3
npm ls mysql2 puppeteer-core basic-ftp extract-zip
npm audit --omit=dev && npm audit
npm test
node scripts/smoke-export.js
```
