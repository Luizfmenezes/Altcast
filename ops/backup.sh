#!/usr/bin/env bash
# ops/backup.sh - dump comprimido do Postgres, com expurgo do que envelheceu.
#
# Roda no host, contra o container. Nao publica porta de banco para isso: o
# `exec` entra pela rede interna do compose, que e a unica que existe.
set -euo pipefail

cd "$(dirname "$0")/.."

DESTINO="${BACKUP_DIR:-./backups}"
RETENCAO_DIAS="${BACKUP_RETENCAO_DIAS:-14}"
USUARIO="${POSTGRES_USER:-altcast}"
BANCO="${POSTGRES_DB:-altcast}"

mkdir -p "$DESTINO"
arquivo="$DESTINO/altcast-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

echo "==> gerando $arquivo"
# --clean --if-exists: o dump se aplica sobre um banco ja povoado sem exigir
# que alguem lembre de derruba-lo antes.
docker compose exec -T postgres \
  pg_dump -U "$USUARIO" -d "$BANCO" --clean --if-exists \
  | gzip -9 > "$arquivo"

# Um dump que nao abre nao e backup. A checagem custa um segundo e separa
# "existe um arquivo" de "existe um backup".
gzip -t "$arquivo"
tamanho="$(wc -c < "$arquivo")"
[ "$tamanho" -gt 1000 ] || { echo "FALHA: dump suspeito de vazio ($tamanho bytes)" >&2; exit 1; }

echo "==> $arquivo ($tamanho bytes)"

# O expurgo vem DEPOIS de o novo dump ser validado: apagar o antigo antes
# deixaria a janela em que nao existe backup nenhum.
echo "==> removendo dumps com mais de $RETENCAO_DIAS dias"
find "$DESTINO" -name 'altcast-*.sql.gz' -type f -mtime "+$RETENCAO_DIAS" -print -delete

# Copia para fora da VPS. Backup que mora no mesmo disco do banco protege
# contra engano humano, e contra absolutamente mais nada.
if [ -n "${BACKUP_REMOTO:-}" ]; then
  echo "==> enviando para $BACKUP_REMOTO"
  rsync -az --remove-source-files=no "$arquivo" "$BACKUP_REMOTO/"
else
  echo 'AVISO: BACKUP_REMOTO nao definido - o dump ficou apenas neste host.' >&2
fi

echo 'backup OK'
