#!/usr/bin/env bash
# Backup diário do banco "boletim" (tudo do sistema está no banco, inclusive logos e arquivos publicados).
# Credenciais: arquivo de opções /etc/boletim/backup.cnf (modo 600, dono root), por exemplo:
#   [client]
#   user=boletim
#   password=SENHA_DO_BANCO
# Uso (root, via cron): /opt/boletim/deploy/backup.sh
# Saída: /var/backups/boletim/boletim-AAAAMMDD-HHMM.sql.gz ; remove arquivos com mais de 28 dias.
# --no-tablespaces: evita exigir o privilégio global PROCESS no MySQL 8.0.21+ (o usuário só tem boletim.*).
# Instalação recomendada: cópia de propriedade do root (veja INSTALL.md): /usr/local/sbin/boletim-backup
# Falhas saem com código != 0 e mensagem em stderr (o cron envia por e-mail).
set -euo pipefail

CNF="${BACKUP_CNF:-/etc/boletim/backup.cnf}"
DB="${BACKUP_DB:-boletim}"
DEST="${BACKUP_DIR:-/var/backups/boletim}"
RETENCAO_DIAS=28

erro() { echo "backup.sh: ERRO: $*" >&2; exit 1; }

[ -r "$CNF" ] || erro "arquivo de credenciais $CNF não encontrado ou ilegível"
mkdir -p "$DEST"
chmod 700 "$DEST"

ARQ="$DEST/boletim-$(date +%Y%m%d-%H%M).sql.gz"
TMP="$ARQ.parcial"
trap 'rm -f "$TMP"' EXIT

mysqldump --defaults-extra-file="$CNF" --single-transaction --no-tablespaces --hex-blob --max-allowed-packet=64M "$DB" | gzip > "$TMP" \
  || erro "mysqldump/gzip falhou"

[ -s "$TMP" ] || erro "dump vazio"
gzip -t "$TMP" || erro "arquivo gzip corrompido"

mv "$TMP" "$ARQ"
trap - EXIT
find "$DEST" -maxdepth 1 -name 'boletim-*.sql.gz' -type f -mtime +"$RETENCAO_DIAS" -delete

echo "backup.sh: OK $ARQ ($(stat -c %s "$ARQ") bytes)"
