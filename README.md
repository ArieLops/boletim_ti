# Comunicado Semanal SENAR-RS

Sistema web interno para montar o Comunicado Semanal da TI do SENAR-RS: o usuário edita os blocos (destaque, cards, dica), vê a prévia e publica a edição, que gera o **PDF** (uma página A4), o **PNG para e-mail** (1240x1754) e o **PNG para WhatsApp** (largura 1080). Node.js 22.12+ (mínimo exigido pelo puppeteer-core 25; ver [docs/seguranca-dependencias.md](docs/seguranca-dependencias.md)), Express 5, MySQL/MariaDB; a exportação usa Chromium headless (puppeteer-core).

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
