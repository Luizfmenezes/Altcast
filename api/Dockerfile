# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependencias. Estagio proprio para que uma mudanca de codigo-fonte nao
# invalide o cache do npm ci, que e a parte cara do build.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
# --ignore-scripts: nenhum pacote executa codigo de instalacao numa imagem que
# vai para producao. O argon2 nativo ja vem pre-compilado para linux-musl.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Build. tsconfig.build.json emite apenas src/, para que dist/index.js exista
# na raiz de dist e as migracoes fiquem no caminho que migrate.ts espera.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY api/ api/
RUN npm --workspace api run build

# ---------------------------------------------------------------------------
# Producao. Dependencias sem as de desenvolvimento, usuario sem privilegio.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS producao
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY api/package.json api/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/api/dist api/dist
# A lista de senhas vazadas nao e codigo, entao o tsc nao a leva junto. Sem
# esta copia o processo morre no primeiro import de password.ts - foi o teste
# de fumaca que encontrou isso, e nao a suite: nenhum teste de unidade roda
# contra a imagem.
COPY api/src/auth/common-passwords.txt api/dist/auth/common-passwords.txt
# SQL puro escrito a mao: as migracoes nao sao compiladas, entao viajam como
# arquivo. Sem elas na imagem, o arranque nao consegue migrar.
COPY api/migrations api/migrations

# `node` ja existe na imagem oficial com uid 1000. Rodar como root daria a
# qualquer falha de execucao remota o controle do container inteiro.
USER node

EXPOSE 3000

# O orquestrador precisa saber a diferenca entre "processo vivo" e "aplicacao
# respondendo" - sao coisas diferentes, e so a segunda importa para o trafego.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "api/dist/index.js"]
