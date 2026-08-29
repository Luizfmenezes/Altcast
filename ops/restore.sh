#!/usr/bin/env bash
# ops/restore.sh - restaura um dump num banco DESCARTAVEL e prova que ele serve.
#
# Restaurar por cima do banco de producao nao e o caminho normal deste script:
# o uso rotineiro e o ensaio. Backup nunca testado nao e backup, e a hora de
# descobrir que o dump esta quebrado nao e a hora do incidente.
set -euo pipefail

cd "$(dirname "$0")/.."

ARQUIVO="${1:-}"
[ -n "$ARQUIVO" ] || { echo "uso: ops/restore.sh <arquivo.sql.gz> [--em-producao]" >&2; exit 1; }
[ -f "$ARQUIVO" ] || { echo "FALHA: $ARQUIVO nao existe" >&2; exit 1; }

USUARIO="${POSTGRES_USER:-altcast}"

if [ "${2:-}" = '--em-producao' ]; then
  echo "==> RESTAURANDO SOBRE O BANCO DE PRODUCAO em 5s. Ctrl-C para abortar."
  sleep 5
  gunzip -c "$ARQUIVO" | docker compose exec -T postgres psql -U "$USUARIO" -d "${POSTGRES_DB:-altcast}"
  echo 'restauracao OK'
  exit 0
fi

# Ensaio: banco novo, ao lado, sem tocar no que esta em uso.
ALVO="ensaio_$(date -u +%Y%m%d%H%M%S)"
echo "==> criando banco de ensaio $ALVO"
docker compose exec -T postgres createdb -U "$USUARIO" "$ALVO"
trap 'docker compose exec -T postgres dropdb -U "$USUARIO" --if-exists "$ALVO" >/dev/null 2>&1 || true' EXIT

echo '==> restaurando'
gunzip -c "$ARQUIVO" | docker compose exec -T postgres psql -U "$USUARIO" -d "$ALVO" -q

echo '==> conferindo o que voltou'
for tabela in users sessions groups group_members channels channel_members messages invites; do
  docker compose exec -T postgres psql -U "$USUARIO" -d "$ALVO" -tAc \
    "SELECT to_regclass('public.$tabela')" | grep -q "$tabela" \
    || { echo "FALHA: tabela $tabela ausente no dump" >&2; exit 1; }
done

usuarios="$(docker compose exec -T postgres psql -U "$USUARIO" -d "$ALVO" -tAc \
  'SELECT count(*) FROM users' | tr -d '[:space:]')"
migracoes="$(docker compose exec -T postgres psql -U "$USUARIO" -d "$ALVO" -tAc \
  'SELECT count(*) FROM _migrations' | tr -d '[:space:]')"

echo "==> $usuarios usuario(s), $migracoes migracao(oes) aplicadas"
[ "$migracoes" -gt 0 ] || { echo 'FALHA: o dump nao trouxe o historico de migracoes' >&2; exit 1; }

echo 'ensaio de restauracao OK'
