# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build dos arquivos estaticos.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY web/ web/
RUN npm --workspace web run build

# ---------------------------------------------------------------------------
# Borda. O Caddy serve os estaticos E faz o proxy para a API, entao a imagem
# do frontend E a imagem da borda: um unico container na frente evita um salto
# de rede extra so para servir arquivo parado.
# ---------------------------------------------------------------------------
FROM caddy:2-alpine AS producao
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv/web

EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/ >/dev/null || exit 1
