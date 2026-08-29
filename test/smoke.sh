#!/usr/bin/env bash
# test/smoke.sh - sobe o stack de producao e verifica o essencial.
#
# Nao substitui a suite: prova que as IMAGENS funcionam montadas, que e
# exatamente o que nenhum teste de unidade alcanca. As duas verificacoes do
# meio sao as que costumam ser esquecidas ate virarem incidente: container
# rodando como root, e banco publicado no host.
set -euo pipefail

cd "$(dirname "$0")/.."

# O Caddy pede TLS automatico para um dominio real; em fumaca a porta 80 basta.
export PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-http://localhost}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-fumaca_local}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost}"

falhar() { echo "FALHA: $1" >&2; exit 1; }

echo '==> subindo o stack'
docker compose up -d --build
trap 'docker compose down -v --remove-orphans' EXIT

echo '==> esperando a API responder'
pronto=0
for _ in $(seq 1 60); do
  if curl -fsS http://localhost/api/health >/dev/null 2>&1; then pronto=1; break; fi
  sleep 2
done
[ "$pronto" = 1 ] || falhar 'a API nao respondeu em 120s'

echo '==> health'
curl -fsS http://localhost/api/health | grep -q '"status":"ok"' \
  || falhar 'health nao devolveu status ok'

echo '==> a API nao roda como root'
uid="$(docker compose exec -T api id -u | tr -d '\r')"
[ "$uid" != '0' ] || falhar 'a API esta rodando como root'

echo '==> o Postgres nao esta publicado no host'
# `docker compose port` sai com 0 e imprime "invalid IP:0" quando NAO existe
# mapeamento, entao o codigo de saida nao serve de resposta. A seta em
# `0.0.0.0:5432->5432/tcp` e o unico sinal inequivoco de porta publicada.
portas_do_banco="$(docker compose ps --format '{{.Ports}}' postgres)"
case "$portas_do_banco" in
  *'->'*) falhar "Postgres exposto no host: $portas_do_banco" ;;
esac

echo '==> o frontend e servido pela raiz'
curl -fsS http://localhost/ | grep -qi '<div id="root"' \
  || falhar 'a raiz nao serviu a aplicacao'

echo '==> as migracoes rodaram antes do trafego'
docker compose exec -T postgres \
  psql -U altcast -d altcast -tAc 'SELECT count(*) FROM _migrations' \
  | grep -qE '[1-9]' || falhar 'nenhuma migracao aplicada'

echo '==> cabecalhos de seguranca'
cabecalhos="$(curl -fsSI http://localhost/)"
grep -qi 'x-content-type-options: nosniff' <<<"$cabecalhos" \
  || falhar 'X-Content-Type-Options ausente'
grep -qi 'content-security-policy' <<<"$cabecalhos" \
  || falhar 'Content-Security-Policy ausente'

echo 'fumaca OK'
