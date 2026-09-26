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
export MINIO_ROOT_USER="${MINIO_ROOT_USER:-altcast}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-fumaca_local_minio}"

falhar() { echo "FALHA: $1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# A trava que faltava.
#
# Este script e de maquina descartavel: ele derruba os volumes na entrada e no
# `trap … EXIT`. Em 2026-09-26 ele foi rodado numa instancia de producao —
# porque o RUNBOOK o sugeria como "verificar que esta de pe" — e apagou o
# Postgres e o MinIO. O dump do Postgres, tirado um minuto antes, salvou o
# banco; os objetos do MinIO nao tinham copia e se perderam.
#
# A verificacao e "existe volume de dados nesta maquina?". Num runner de CI,
# que e onde este script pertence, nao existe: o disco nasce limpo a cada
# execucao. Onde existe, existe alguem para perguntar primeiro.
# ---------------------------------------------------------------------------
if [ "${SMOKE_DESCARTAVEL:-0}" != '1' ]; then
  # O nome do projeto do compose, que prefixa os volumes. Sem variavel, o
  # compose usa o nome do diretorio — daqui, a raiz do repositorio.
  projeto="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
  padrao="^${projeto}_(pgdata|minio_data)$"
  volumes="$(docker volume ls -q 2>/dev/null | grep -E "$padrao" || true)"
  if [ -n "$volumes" ]; then
    echo 'FALHA: ha volume de dados nesta maquina, e este script apaga volumes.' >&2
    echo >&2
    echo "$volumes" | sed 's/^/  /' >&2
    echo >&2
    echo 'Para verificar uma instancia VIVA use, em vez disto:' >&2
    echo '  curl -fsS http://localhost/api/health && docker compose ps' >&2
    echo >&2
    echo 'Se esta maquina e mesmo descartavel: SMOKE_DESCARTAVEL=1 bash test/smoke.sh' >&2
    exit 1
  fi
fi

echo '==> subindo o stack'
# Estado limpo antes de subir: reconstruir por cima de um stack vivo faz o
# container novo disputar com o antigo e o `depends_on: service_healthy`
# desistir antes de a API ficar pronta.
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
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

echo '==> o MinIO nao esta publicado no host'
# Mesma logica da checagem do Postgres, e pela mesma razao — so que aqui o
# risco e maior: uma porta publicada do storage entregaria anexo de canal
# privado a quem tivesse a URL, sem passar por `can()` nenhuma vez.
portas_do_minio="$(docker compose ps --format '{{.Ports}}' minio)"
case "$portas_do_minio" in
  *'->'*) falhar "MinIO exposto no host: $portas_do_minio" ;;
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
