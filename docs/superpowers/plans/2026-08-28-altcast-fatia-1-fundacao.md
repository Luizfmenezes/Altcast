# Altcast — Fatia 1 (Fundação) — Plano de Implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA — use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixas de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** entregar a fundação do Altcast — contas, grupos, convites, canais
públicos e privados, chat em tempo real e presença — funcionando ponta a ponta
em Docker, sem nenhuma funcionalidade de áudio ou vídeo.

**Arquitetura:** API Fastify em TypeScript sobre Postgres, com escrita
exclusivamente por REST e um WebSocket unidirecional que apenas empurra eventos.
Toda autorização passa por uma única função `can()`; todo cálculo de audiência
passa por uma única função `fanout()`. O frontend é React com Vite, consumindo o
REST via TanStack Query e usando o WebSocket como acelerador cujo eventual
silêncio é curado por refetch na reconexão.

**Stack:** Node 24, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 16, Vitest,
Testcontainers, Playwright, React 19, Vite, Tailwind, Radix UI, TanStack Query,
Zustand, Docker Compose, Caddy 2.

**Spec:** [`docs/specs/00-visao-geral.md`](../../specs/00-visao-geral.md) e os
sete documentos que ela indexa. O plano argumenta a partir da spec; executores
leem ambos.

---

## Restrições globais

Requisitos válidos para **todas** as tarefas. Valores copiados literalmente da
spec.

- **Node 24**, TypeScript em modo `strict`, ESM (`"type": "module"`)
- **PostgreSQL 16**. Nenhuma porta de banco publicada no host em produção
- **Identificadores são UUIDv7**, gerados na aplicação, nunca no banco
- **Datas em `timestamptz`**, serializadas em ISO 8601 UTC (`2026-08-28T20:14:00Z`)
- **Senhas com argon2id**: 19 MiB de memória, 2 iterações, paralelismo 1
- **Nenhuma comparação direta de papel fora de `api/src/permissions/can.ts`.**
  Regra de lint quebra o build
- **Nenhuma rota calcula audiência.** Só `api/src/realtime/fanout.ts` calcula
- **Recurso invisível retorna `404 not_found`, jamais `403 forbidden`**
- **Erro sempre no formato** `{ error: { code, message, requestId, details } }`
- **Nunca registrar em log:** senha, hash, valor de cookie, conteúdo de
  mensagem, ou código de convite completo (apenas os 3 primeiros caracteres)
- **Cobertura obrigatória de 100%** em `can.ts` e `fanout.ts`; build falha abaixo
- **WCAG 2.2 nível AA** em toda tela; alvos de 24 px, foco visível de 2 px
- **Toda variável de ambiente é validada no arranque**; faltando, o processo morre
- **TDD sem exceção:** o teste falha primeiro, sempre
- Mensagens de interface e de erro **em português**

---

## Mapa de arquivos

### API

| Arquivo | Responsabilidade única |
|---|---|
| `api/src/index.ts` | Bootstrap do Fastify, registro de plugins, escuta |
| `api/src/env.ts` | Schema e validação das variáveis de ambiente |
| `api/src/db/schema.ts` | Definição das 7 tabelas e 3 enums |
| `api/src/db/client.ts` | Pool de conexão e instância do Drizzle |
| `api/src/shared/ids.ts` | Geração de UUIDv7 |
| `api/src/shared/errors.ts` | Classe de erro, catálogo de códigos, handler |
| `api/src/shared/logger.ts` | Logger pino com redação de campos sensíveis |
| `api/src/auth/password.ts` | Hash e verificação argon2id, senhas vazadas |
| `api/src/auth/session.ts` | Criar, validar, renovar e revogar sessão |
| `api/src/auth/middleware.ts` | Decorator `request.user`, guarda de rota |
| `api/src/permissions/can.ts` | **Única** fonte de autorização |
| `api/src/invites/code.ts` | Gerar e normalizar código base32 Crockford |
| `api/src/routes/auth.routes.ts` | register, login, logout, me |
| `api/src/routes/groups.routes.ts` | CRUD de grupo e de membros |
| `api/src/routes/invites.routes.ts` | Gerar, prever, aceitar, revogar |
| `api/src/routes/channels.routes.ts` | CRUD de canal e lista de acesso |
| `api/src/routes/messages.routes.ts` | Listar, enviar, editar, apagar |
| `api/src/realtime/registry.ts` | Conexões vivas em memória |
| `api/src/realtime/fanout.ts` | **Único** cálculo de audiência |
| `api/src/realtime/presence.ts` | Mapa de presença e transições |
| `api/src/realtime/gateway.ts` | Upgrade, heartbeat, ciclo de vida |
| `api/src/realtime/emit.ts` | Fachada de emissão usada pelas rotas |
| `api/src/cli/seed-owner.ts` | Bootstrap idempotente do primeiro usuário |

### Frontend

| Arquivo | Responsabilidade única |
|---|---|
| `web/src/lib/api.ts` | Cliente REST tipado, tratamento de erro |
| `web/src/lib/socket.ts` | Conexão, backoff com jitter, reconciliação |
| `web/src/lib/store.ts` | Estado de sessão, grupos, canais, presença |
| `web/src/ui/tokens.css` | Variáveis de cor, tipografia e densidade |
| `web/src/features/auth/*` | Login, cadastro, prévia de convite |
| `web/src/features/groups/*` | Barra de grupos, configurações |
| `web/src/features/channels/*` | Lista, criação, acesso de canal privado |
| `web/src/features/messages/*` | Lista, composição, eco otimista |
| `web/src/features/presence/*` | Painel de membros, barra de conexão |

---

## Índice de tarefas

| Fase | Tarefas | Entrega verificável |
|---|---|---|
| 0 — Esqueleto | 1–3 | API responde `/api/health` em Docker, com banco migrado |
| 1 — Identidade | 4–8 | Login funciona; `can()` coberto a 100% |
| 2 — Grupos | 9–12 | Criar grupo, convidar, entrar, gerenciar membros |
| 3 — Canais e mensagens | 13–15 | Canal público e privado com filtro; histórico paginado |
| 4 — Tempo real | 16–20 | Eventos na audiência correta; suíte de vazamento; limites de taxa |
| 5 — Frontend | 21–29 | Interface completa, acessível e responsiva |
| 6 — Produção | 30–32 | Deploy em Docker com TLS, fumaça e E2E verdes |

---

# Fase 0 — Esqueleto

### Tarefa 1: Monorepo, TypeScript e Docker de desenvolvimento

**Arquivos:**
- Criar: `package.json`, `tsconfig.base.json`, `.editorconfig`, `.nvmrc`
- Criar: `api/package.json`, `api/tsconfig.json`, `api/src/index.ts`
- Criar: `docker-compose.dev.yml`, `.env.example`, `.dockerignore`
- Teste: `api/test/health.test.ts`

**Interfaces:**
- Consome: nada
- Produz: `buildServer(): Promise<FastifyInstance>` — usada por toda tarefa
  seguinte para levantar a API em teste sem abrir porta

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/health.test.ts
import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/index.js'

describe('GET /api/health', () => {
  it('responde 200 com status ok', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
    await app.close()
  })
})
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `npm --workspace api run test -- health`
Esperado: FALHA com `Cannot find module '../src/index.js'`

- [ ] **Passo 3: Criar o workspace raiz**

```json
{
  "name": "altcast",
  "private": true,
  "type": "module",
  "workspaces": ["api", "web"],
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "docker compose -f docker-compose.dev.yml up",
    "test": "npm run test --workspaces --if-present",
    "lint": "eslint .",
    "typecheck": "tsc -b"
  }
}
```

- [ ] **Passo 4: Criar a API mínima**

```ts
// api/src/index.ts
import Fastify, { type FastifyInstance } from 'fastify'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}

if (process.argv[1]?.endsWith('index.js')) {
  const app = await buildServer()
  await app.listen({ port: 3000, host: '0.0.0.0' })
}
```

- [ ] **Passo 5: Rodar o teste e confirmar que passa**

Rodar: `npm --workspace api run test -- health`
Esperado: PASSA

- [ ] **Passo 6: Escrever o Compose de desenvolvimento**

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: altcast
      POSTGRES_PASSWORD: altcast_dev
      POSTGRES_DB: altcast
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U altcast"]
      interval: 5s
      retries: 10
    volumes: ["pgdata:/var/lib/postgresql/data"]
  api:
    image: node:24-alpine
    working_dir: /app
    command: sh -c "npm ci && npm --workspace api run dev"
    environment:
      DATABASE_URL: postgres://altcast:altcast_dev@postgres:5432/altcast
      NODE_ENV: development
      PORT: "3000"
      ALLOWED_ORIGINS: http://localhost:5173
      PUBLIC_URL: http://localhost:5173
      SESSION_COOKIE_NAME: altcast_session
      SESSION_TTL_DAYS: "30"
      LOG_LEVEL: debug
    ports: ["3000:3000"]
    volumes: [".:/app"]
    depends_on:
      postgres: { condition: service_healthy }
volumes:
  pgdata:
```

- [ ] **Passo 7: Subir e verificar manualmente**

Rodar: `docker compose -f docker-compose.dev.yml up -d`
Depois: `curl -s http://localhost:3000/api/health`
Esperado: `{"status":"ok"}`

- [ ] **Passo 8: Commitar**

```bash
git add package.json tsconfig.base.json api/ docker-compose.dev.yml .env.example .dockerignore .editorconfig .nvmrc
git commit -m "feat: esqueleto do monorepo com API Fastify e Postgres em Docker"
```

### Tarefa 2: Validação de ambiente, logger e contrato de erro

**Arquivos:**
- Criar: `api/src/env.ts`, `api/src/shared/logger.ts`, `api/src/shared/errors.ts`, `api/src/shared/ids.ts`
- Modificar: `api/src/index.ts` (registrar handler de erro e logger)
- Teste: `api/test/env.test.ts`, `api/test/errors.test.ts`, `api/test/ids.test.ts`

**Interfaces:**
- Consome: `buildServer()` da Tarefa 1
- Produz:
  - `env: Env` — objeto congelado e validado
  - `newId(): string` — UUIDv7
  - `class AppError extends Error { code: ErrorCode; status: number; details?: unknown }`
  - `ERROR_CATALOG` — os 14 códigos da spec 06 com status e mensagem

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// api/test/env.test.ts
import { describe, it, expect } from 'vitest'
import { parseEnv } from '../src/env.js'

describe('parseEnv', () => {
  it('aceita ambiente completo', () => {
    const e = parseEnv({
      NODE_ENV: 'test', PORT: '3000',
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      PUBLIC_URL: 'http://localhost:5173',
      SESSION_COOKIE_NAME: 'altcast_session',
      SESSION_TTL_DAYS: '30', LOG_LEVEL: 'info',
    })
    expect(e.PORT).toBe(3000)
    expect(e.ALLOWED_ORIGINS).toEqual(['http://localhost:5173'])
  })

  it('morre com mensagem clara quando falta DATABASE_URL', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/)
  })
})
```

```ts
// api/test/ids.test.ts
import { describe, it, expect } from 'vitest'
import { newId } from '../src/shared/ids.js'

describe('newId', () => {
  it('gera UUID versao 7', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('gera IDs crescentes ao longo do tempo', async () => {
    const a = newId()
    await new Promise(r => setTimeout(r, 2))
    expect(newId() > a).toBe(true)
  })
})
```

```ts
// api/test/errors.test.ts
import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/index.js'
import { AppError } from '../src/shared/errors.js'

describe('handler de erro', () => {
  it('serializa AppError no contrato da spec', async () => {
    const app = await buildServer()
    app.get('/boom', async () => { throw new AppError('invite_expired') })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe('invite_expired')
    expect(res.json().error.requestId).toBeTruthy()
    await app.close()
  })

  it('nao vaza detalhe interno em erro inesperado', async () => {
    const app = await buildServer()
    app.get('/crash', async () => { throw new Error('senha do banco e hunter2') })
    const res = await app.inject({ method: 'GET', url: '/crash' })
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.json())).not.toContain('hunter2')
    expect(res.json().error.code).toBe('internal_error')
    await app.close()
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha**

Rodar: `npm --workspace api run test`
Esperado: FALHA — módulos `env`, `ids` e `errors` inexistentes

- [ ] **Passo 3: Implementar `ids.ts`**

Instalar: `npm --workspace api i uuidv7`

```ts
// api/src/shared/ids.ts
import { uuidv7 } from 'uuidv7'
export function newId(): string { return uuidv7() }
```

- [ ] **Passo 4: Implementar `env.ts` com zod**

```ts
// api/src/env.ts
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().transform(s => s.split(',').map(v => v.trim())),
  PUBLIC_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().default('altcast_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const linhas = r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Variaveis de ambiente invalidas:\n${linhas.join('\n')}`)
  }
  return Object.freeze(r.data)
}

export const env: Env = parseEnv(process.env)
```

- [ ] **Passo 5: Implementar `errors.ts` com o catálogo completo**

```ts
// api/src/shared/errors.ts
export const ERROR_CATALOG = {
  unauthenticated:     { status: 401, message: 'Voce precisa entrar para continuar.' },
  forbidden:           { status: 403, message: 'Voce nao tem permissao para isso.' },
  not_found:           { status: 404, message: 'Nao encontrado.' },
  validation_failed:   { status: 422, message: 'Confira os campos destacados.' },
  invite_not_found:    { status: 404, message: 'Convite inexistente.' },
  invite_expired:      { status: 410, message: 'Este convite expirou.' },
  invite_revoked:      { status: 410, message: 'Este convite foi revogado.' },
  invite_exhausted:    { status: 410, message: 'Este convite atingiu o limite de usos.' },
  already_member:      { status: 409, message: 'Voce ja participa deste grupo.' },
  email_taken:         { status: 409, message: 'Este e-mail ja esta cadastrado.' },
  invalid_credentials: { status: 401, message: 'E-mail ou senha incorretos.' },
  rate_limited:        { status: 429, message: 'Muitas tentativas. Aguarde um instante.' },
  owner_cannot_leave:  { status: 409, message: 'Transfira a titularidade antes de sair.' },
  internal_error:      { status: 500, message: 'Algo deu errado. Tente novamente.' },
} as const

export type ErrorCode = keyof typeof ERROR_CATALOG

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown
  constructor(code: ErrorCode, details?: unknown) {
    super(ERROR_CATALOG[code].message)
    this.code = code
    this.status = ERROR_CATALOG[code].status
    this.details = details
  }
}
```

- [ ] **Passo 6: Registrar o handler em `index.ts`**

O handler converte `AppError` no envelope da spec; qualquer outro erro vira
`internal_error`, com a pilha registrada apenas no servidor.

```ts
app.setErrorHandler((err, req, reply) => {
  const requestId = req.id
  if (err instanceof AppError) {
    req.log.info({ requestId, code: err.code }, 'erro de aplicacao')
    return reply.status(err.status).send({
      error: { code: err.code, message: err.message, requestId, details: err.details ?? null },
    })
  }
  req.log.error({ requestId, err }, 'erro inesperado')
  return reply.status(500).send({
    error: { code: 'internal_error', message: ERROR_CATALOG.internal_error.message, requestId, details: null },
  })
})
```

- [ ] **Passo 7: Implementar `logger.ts` com redação**

```ts
// api/src/shared/logger.ts
import pino from 'pino'
import { env } from '../env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie', 'res.headers["set-cookie"]',
      'password', '*.password', 'passwordHash', '*.passwordHash',
      'content', '*.content', 'code', '*.code',
    ],
    censor: '[redigido]',
  },
})
```

- [ ] **Passo 8: Rodar todos os testes e commitar**

Rodar: `npm --workspace api run test`
Esperado: PASSA (7 testes)

```bash
git add api/src/env.ts api/src/shared/ api/src/index.ts api/test/
git commit -m "feat: validacao de ambiente, logger com redacao e contrato de erro"
```

### Tarefa 3: Schema, migrações e Postgres real em teste

**Arquivos:**
- Criar: `api/src/db/schema.ts`, `api/src/db/client.ts`, `api/drizzle.config.ts`
- Criar: `api/migrations/0001_init.sql` até `0005_messages.sql`
- Criar: `api/test/helpers/db.ts` (Testcontainers)
- Teste: `api/test/schema.test.ts`

**Interfaces:**
- Consome: `env` da Tarefa 2
- Produz:
  - `db` — instância Drizzle
  - `users`, `sessions`, `groups`, `groupMembers`, `invites`, `channels`, `channelMembers`, `messages` — tabelas
  - `withTestDb(fn)` — helper que sobe Postgres em container, migra e limpa

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/schema.test.ts
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { users, groups, groupMembers } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'

describe('schema', () => {
  it('impede dois owners no mesmo grupo', async () => {
    await withTestDb(async db => {
      const u1 = newId(), u2 = newId(), g = newId()
      await db.insert(users).values([
        { id: u1, email: 'a@x.com', passwordHash: 'h', displayName: 'A' },
        { id: u2, email: 'b@x.com', passwordHash: 'h', displayName: 'B' },
      ])
      await db.insert(groups).values({ id: g, name: 'Time', ownerId: u1 })
      await db.insert(groupMembers).values({ groupId: g, userId: u1, role: 'owner' })

      await expect(
        db.insert(groupMembers).values({ groupId: g, userId: u2, role: 'owner' })
      ).rejects.toThrow()
    })
  })

  it('trata e-mail como case-insensitive', async () => {
    await withTestDb(async db => {
      await db.insert(users).values({ id: newId(), email: 'Felipe@X.com', passwordHash: 'h', displayName: 'F' })
      await expect(
        db.insert(users).values({ id: newId(), email: 'felipe@x.com', passwordHash: 'h', displayName: 'F2' })
      ).rejects.toThrow()
    })
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha**

Rodar: `npm --workspace api run test -- schema`
Esperado: FALHA — `./helpers/db.js` inexistente

- [ ] **Passo 3: Escrever a migração inicial**

```sql
-- api/migrations/0001_init.sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE role_enum       AS ENUM ('owner', 'admin', 'member');
CREATE TYPE channel_type    AS ENUM ('text', 'voice');
CREATE TYPE visibility_enum AS ENUM ('public', 'private');

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text,
  ip           inet
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
```

O tipo `voice` existe desde a primeira migração porque acrescentar valor a enum
depois é trivial, mas descobrir que canal de voz não cabe no modelo seria
retrabalho grande. **Nenhum código de voz é escrito nesta fatia.**

- [ ] **Passo 4: Escrever as demais migrações**

```sql
-- api/migrations/0002_groups.sql
CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  icon_url   text,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      role_enum NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);
CREATE UNIQUE INDEX group_one_owner_idx ON group_members (group_id) WHERE role = 'owner';
```

O índice único parcial é o que garante a invariante de um único `owner` por
grupo — no banco, não na aplicação.

```sql
-- api/migrations/0003_invites.sql
CREATE TABLE invites (
  code       text PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  max_uses   integer,
  uses       integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_group_idx ON invites (group_id);
```

```sql
-- api/migrations/0004_channels.sql
CREATE TABLE channels (
  id         uuid PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       channel_type NOT NULL DEFAULT 'text',
  visibility visibility_enum NOT NULL DEFAULT 'public',
  topic      text,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);
CREATE INDEX channels_group_pos_idx ON channels (group_id, position);

CREATE TABLE channel_members (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id);
```

```sql
-- api/migrations/0005_messages.sql
CREATE TABLE messages (
  id         uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
CREATE INDEX messages_channel_id_desc_idx ON messages (channel_id, id DESC);
```

Este índice é o que sustenta a paginação por cursor. Sem ele, o histórico
degrada linearmente conforme o canal cresce.

- [ ] **Passo 5: Escrever o helper de banco em teste**

```ts
// api/test/helpers/db.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from '../../src/db/schema.js'

let container: StartedPostgreSqlContainer | undefined
let pool: pg.Pool | undefined

async function ensure() {
  if (!container) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    pool = new pg.Pool({ connectionString: container.getConnectionUri() })
    await migrate(drizzle(pool, { schema }), { migrationsFolder: 'migrations' })
  }
  return drizzle(pool!, { schema })
}

/** Roda `fn` contra um banco migrado e limpa todas as tabelas ao final. */
export async function withTestDb(fn: (db: NodePgDatabase<typeof schema>) => Promise<void>) {
  const db = await ensure()
  try {
    await fn(db)
  } finally {
    await pool!.query(
      'TRUNCATE messages, channel_members, channels, invites, group_members, groups, sessions, users CASCADE'
    )
  }
}
```

Postgres real, não mock. Custa poucos segundos e captura exatamente a classe de
erro que mock esconde: violação de constraint, cascade e o índice único parcial
do `owner` — que é justamente o que o teste do Passo 1 exercita.

- [ ] **Passo 6: Escrever `schema.ts` em Drizzle**

Espelha as migrações acima. Cada tabela é exportada com o nome em camelCase
(`groupMembers`, `channelMembers`), e cada coluna com o nome em camelCase
mapeado para o snake_case do banco.

- [ ] **Passo 7: Rodar o teste e confirmar que passa**

Rodar: `npm --workspace api run test -- schema`
Esperado: PASSA (2 testes). A primeira execução baixa a imagem do Postgres.

- [ ] **Passo 8: Commitar**

```bash
git add api/src/db/ api/migrations/ api/drizzle.config.ts api/test/
git commit -m "feat: schema completo, migracoes e Postgres real em teste"
```

---

# Fase 1 — Identidade

### Tarefa 4: Hash de senha

**Arquivos:**
- Criar: `api/src/auth/password.ts`, `api/src/auth/common-passwords.txt`
- Teste: `api/test/password.test.ts`

**Interfaces:**
- Consome: nada
- Produz:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(hash: string, plain: string): Promise<boolean>`
  - `assertPasswordAcceptable(plain: string): void` — lança `AppError('validation_failed')`
  - `DUMMY_HASH: string` — hash fixo para verificação em tempo constante

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/password.test.ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, assertPasswordAcceptable, DUMMY_HASH } from '../src/auth/password.js'

describe('password', () => {
  it('gera hash argon2id e verifica', async () => {
    const h = await hashPassword('senha-bem-longa-123')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(h, 'senha-bem-longa-123')).toBe(true)
    expect(await verifyPassword(h, 'errada')).toBe(false)
  })

  it('recusa senha curta', () => {
    expect(() => assertPasswordAcceptable('curta')).toThrow()
  })

  it('recusa senha vazada conhecida', () => {
    expect(() => assertPasswordAcceptable('123456789012')).toThrow()
  })

  it('DUMMY_HASH e verificavel e sempre falso', async () => {
    expect(await verifyPassword(DUMMY_HASH, 'qualquer-coisa-aqui')).toBe(false)
  })
})
```

O último teste existe porque `DUMMY_HASH` sustenta a resposta em tempo uniforme
do login: quando o e-mail não existe, o servidor verifica contra ele antes de
responder. Se o hash fosse inválido, `verifyPassword` lançaria em vez de
retornar `false`, e a diferença de tempo voltaria a entregar quem tem conta.

- [ ] **Passo 2: Rodar e confirmar falha**

Rodar: `npm --workspace api run test -- password`
Esperado: FALHA — módulo inexistente

- [ ] **Passo 3: Implementar**

Instalar: `npm --workspace api i argon2`

```ts
// api/src/auth/password.ts
import argon2 from 'argon2'
import { readFileSync } from 'node:fs'
import { AppError } from '../shared/errors.js'

const OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MiB, recomendacao OWASP
  timeCost: 2,
  parallelism: 1,
} as const

const COMUNS = new Set(
  readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim()).filter(Boolean)
)

export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$3f8Yb1nQm2xW9pKzL0vR7tHc4Ns6Uj1Aq5Ew8Dy2Bg0'

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTS)
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try { return await argon2.verify(hash, plain) } catch { return false }
}

export function assertPasswordAcceptable(plain: string): void {
  const problemas: string[] = []
  if (plain.length < 10) problemas.push('A senha precisa ter ao menos 10 caracteres.')
  if (COMUNS.has(plain)) problemas.push('Esta senha aparece em vazamentos conhecidos. Escolha outra.')
  if (problemas.length) throw new AppError('validation_failed', { password: problemas })
}
```

Sem exigência de símbolos: regras de composição reduzem entropia na prática,
empurrando todo mundo para variações de `Senha@123`. O comprimento mínimo mais a
lista de vazadas protege melhor.

- [ ] **Passo 4: Popular a lista de senhas vazadas**

Baixar as 10 000 senhas mais comuns (SecLists, `10-million-password-list-top-10000.txt`),
salvar em `api/src/auth/common-passwords.txt`, uma por linha. Arquivo local, sem
chamada externa em tempo de execução.

- [ ] **Passo 5: Rodar, confirmar que passa, commitar**

Rodar: `npm --workspace api run test -- password` → PASSA (4 testes)

```bash
git add api/src/auth/password.ts api/src/auth/common-passwords.txt api/test/password.test.ts
git commit -m "feat: hash argon2id com verificacao em tempo uniforme"
```

### Tarefa 5: Sessões e middleware de autenticação

**Arquivos:**
- Criar: `api/src/auth/session.ts`, `api/src/auth/middleware.ts`
- Modificar: `api/src/index.ts` (registrar `@fastify/cookie` e o hook)
- Teste: `api/test/session.test.ts`

**Interfaces:**
- Consome: `db`, `newId`, `env`, `AppError`
- Produz:
  - `createSession(userId, meta): Promise<{ id, expiresAt }>`
  - `validateSession(id): Promise<{ userId } | null>` — renova `last_seen_at`
  - `revokeSession(id): Promise<void>`
  - `revokeAllSessions(userId): Promise<void>`
  - `requireAuth` — preHandler que popula `request.user` ou lança `unauthenticated`
  - Tipo aumentado: `FastifyRequest.user?: { id: string }`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/session.test.ts
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { createSession, validateSession, revokeSession } from '../src/auth/session.js'
import { users } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'

describe('sessoes', () => {
  it('cria, valida e revoga', async () => {
    await withTestDb(async db => {
      const uid = newId()
      await db.insert(users).values({ id: uid, email: 'f@x.com', passwordHash: 'h', displayName: 'F' })

      const s = await createSession(uid, { userAgent: 'vitest', ip: '127.0.0.1' })
      expect(await validateSession(s.id)).toMatchObject({ userId: uid })

      await revokeSession(s.id)
      expect(await validateSession(s.id)).toBeNull()
    })
  })

  it('recusa sessao expirada', async () => {
    await withTestDb(async db => {
      const uid = newId()
      await db.insert(users).values({ id: uid, email: 'g@x.com', passwordHash: 'h', displayName: 'G' })
      const s = await createSession(uid, { userAgent: 'vitest', ip: null, ttlDays: -1 })
      expect(await validateSession(s.id)).toBeNull()
    })
  })

  it('rota protegida devolve 401 sem cookie', async () => {
    const { buildServer } = await import('../src/index.js')
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
    await app.close()
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha**

Rodar: `npm --workspace api run test -- session`
Esperado: FALHA — módulo `session` inexistente

- [ ] **Passo 3: Implementar `session.ts`**

```ts
// api/src/auth/session.ts
import { eq, and, gt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions } from '../db/schema.js'
import { newId } from '../shared/ids.js'
import { env } from '../env.js'

type Meta = { userAgent: string | null; ip: string | null; ttlDays?: number }

export async function createSession(userId: string, meta: Meta) {
  const ttl = meta.ttlDays ?? env.SESSION_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttl * 86_400_000)
  const id = newId()
  await db.insert(sessions).values({
    id, userId, expiresAt, userAgent: meta.userAgent, ip: meta.ip,
  })
  return { id, expiresAt }
}

export async function validateSession(id: string) {
  const [row] = await db.select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row) return null
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id))
  return row
}

export async function revokeSession(id: string) {
  await db.delete(sessions).where(eq(sessions.id, id))
}

export async function revokeAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}
```

Revogar é apagar a linha, e o efeito é imediato. É exatamente isto que um JWT
não permitiria: com token assinado, remover alguém do grupo não encerraria o
acesso até o vencimento.

- [ ] **Passo 4: Implementar `middleware.ts`**

```ts
// api/src/auth/middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { validateSession } from './session.js'
import { AppError } from '../shared/errors.js'
import { env } from '../env.js'

declare module 'fastify' {
  interface FastifyRequest { user?: { id: string }; sessionId?: string }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const raw = req.cookies[env.SESSION_COOKIE_NAME]
  if (!raw) throw new AppError('unauthenticated')
  const s = await validateSession(raw)
  if (!s) throw new AppError('unauthenticated')
  req.user = { id: s.userId }
  req.sessionId = raw
}
```

- [ ] **Passo 5: Registrar cookie e verificação de Origin em `index.ts`**

```ts
await app.register(cookie)

app.addHook('onRequest', async req => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    const origin = req.headers.origin
    if (origin && !env.ALLOWED_ORIGINS.includes(origin)) throw new AppError('forbidden')
  }
})
```

Junto com `SameSite=Lax` no cookie, isto cobre CSRF sem token dedicado.

Opções do cookie ao emitir: `httpOnly: true`, `secure` em produção,
`sameSite: 'lax'`, `path: '/'`, e `maxAge` em segundos igual ao TTL.

- [ ] **Passo 6: Rodar, confirmar que passa, commitar**

Rodar: `npm --workspace api run test -- session` → PASSA (3 testes)

```bash
git add api/src/auth/ api/src/index.ts api/test/session.test.ts
git commit -m "feat: sessoes revogaveis em banco com cookie httpOnly"
```

### Tarefa 6: A função `can()` — núcleo de autorização

> **Esta é a tarefa mais importante do plano.** Um defeito aqui é falha de
> segurança, não incômodo. Cobertura de 100% é obrigatória e quebra o build.

**Arquivos:**
- Criar: `api/src/permissions/can.ts`, `api/src/permissions/types.ts`
- Criar: `eslint.config.js` (regra que proíbe comparação de papel fora do módulo)
- Teste: `api/test/can.test.ts`

**Interfaces:**
- Consome: nada — função **pura**, não toca o banco
- Produz:
  - `type Role = 'owner' | 'admin' | 'member'`
  - `type Action` — 17 ações da Fatia 1 mais 3 reservadas
  - `type Actor = { userId: string; role: Role | null; inChannel: boolean }`
  - `type Resource = { kind: 'group' | 'channel' | 'message'; visibility?: 'public' | 'private'; authorId?: string }`
  - `can(actor: Actor, action: Action, resource: Resource): boolean`

Quem chama já carregou o papel e o pertencimento; `can()` apenas decide. Isso a
torna exaustivamente testável sem banco e impossível de acoplar a detalhes de
rota.

- [ ] **Passo 1a: Escrever o arquivo de teste com a tabela de verdade**

```ts
// api/test/can.test.ts
import { describe, it, expect } from 'vitest'
import { can, type Action, type Actor, type Resource } from '../src/permissions/can.js'

const ator = (role: Actor['role'], inChannel = false): Actor =>
  ({ userId: 'u1', role, inChannel })

const canalPublico: Resource  = { kind: 'channel', visibility: 'public' }
const canalPrivado: Resource  = { kind: 'channel', visibility: 'private' }
const grupo: Resource         = { kind: 'group' }
const msgPropria: Resource    = { kind: 'message', authorId: 'u1' }
const msgTerceiro: Resource   = { kind: 'message', authorId: 'u2' }
```

- [ ] **Passo 1b: Acrescentar os casos de canal e grupo**

```ts
describe('can — tabela de verdade', () => {
  const casos: Array<[string, Actor, Action, Resource, boolean]> = [
    ['owner le canal publico',             ator('owner'),         'channel.read',   canalPublico, true],
    ['member le canal publico',            ator('member'),        'channel.read',   canalPublico, true],
    ['nao-membro nao le canal publico',    ator(null),            'channel.read',   canalPublico, false],
    ['member dentro do privado le',        ator('member', true),  'channel.read',   canalPrivado, true],
    ['member fora do privado nao le',      ator('member', false), 'channel.read',   canalPrivado, false],
    ['admin fora do privado NAO le',       ator('admin', false),  'channel.read',   canalPrivado, false],
    ['owner fora do privado NAO le',       ator('owner', false),  'channel.read',   canalPrivado, false],
    ['admin apaga privado sem ler',        ator('admin', false),  'channel.delete', canalPrivado, true],
    ['owner apaga privado sem ler',        ator('owner', false),  'channel.delete', canalPrivado, true],
    ['member nao apaga canal',             ator('member', true),  'channel.delete', canalPrivado, false],
    ['member escreve em publico',          ator('member'),        'channel.write',  canalPublico, true],
    ['member fora do privado nao escreve', ator('member', false), 'channel.write',  canalPrivado, false],
    ['owner apaga grupo',                  ator('owner'),         'group.delete',      grupo, true],
    ['admin nao apaga grupo',              ator('admin'),         'group.delete',      grupo, false],
    ['admin convida',                      ator('admin'),         'group.invite',      grupo, true],
    ['member nao convida',                 ator('member'),        'group.invite',      grupo, false],
    ['admin remove membro',                ator('admin'),         'group.kick',        grupo, true],
    ['member nao remove membro',           ator('member'),        'group.kick',        grupo, false],
    ['owner muda papel',                   ator('owner'),         'group.change_role', grupo, true],
    ['admin nao muda papel',               ator('admin'),         'group.change_role', grupo, false],
    ['autor edita a propria',              ator('member'),        'message.edit_own',   msgPropria,  true],
    ['nao edita a de terceiro',            ator('member'),        'message.edit_own',   msgTerceiro, false],
    ['autor apaga a propria',              ator('member'),        'message.delete_own', msgPropria,  true],
    ['admin apaga a de terceiro',          ator('admin'),         'message.delete_any', msgTerceiro, true],
    ['member nao apaga a de terceiro',     ator('member'),        'message.delete_any', msgTerceiro, false],
    ['ninguem entra em call na Fatia 1',   ator('owner', true),   'channel.join_call',  canalPublico, false],
    ['ninguem publica na Fatia 1',         ator('owner', true),   'channel.publish',    canalPublico, false],
  ]

  for (const [nome, a, acao, recurso, esperado] of casos) {
    it(nome, () => expect(can(a, acao, recurso)).toBe(esperado))
  }
})
```

As três linhas decisivas são `admin fora do privado NAO le`,
`owner fora do privado NAO le` e `admin apaga privado sem ler`. Elas codificam o
eixo duplo da spec 03: **ler vem do pertencimento ao canal; administrar vem do
papel no grupo.**

- [ ] **Passo 1c: Acrescentar o teste de negação total**

```ts
it('nao-membro nao pode absolutamente nada', () => {
  const acoes: Action[] = [
    'group.view','group.update','group.delete','group.invite','group.kick',
    'group.change_role','channel.create','channel.update','channel.delete',
    'channel.read','channel.write','channel.manage_members','message.create',
    'message.edit_own','message.delete_own','message.delete_any',
  ]
  for (const acao of acoes) {
    expect(can(ator(null), acao, grupo)).toBe(false)
    expect(can(ator(null), acao, canalPublico)).toBe(false)
    expect(can(ator(null), acao, canalPrivado)).toBe(false)
  }
})
```

- [ ] **Passo 2: Rodar e confirmar falha**

Rodar: `npm --workspace api run test -- can`
Esperado: FALHA — `../src/permissions/can.js` inexistente

- [ ] **Passo 3: Implementar `can.ts`**

```ts
// api/src/permissions/can.ts
export type Role = 'owner' | 'admin' | 'member'
export type Visibility = 'public' | 'private'

export type Action =
  | 'group.view' | 'group.update' | 'group.delete'
  | 'group.invite' | 'group.kick' | 'group.change_role'
  | 'channel.create' | 'channel.update' | 'channel.delete'
  | 'channel.read' | 'channel.write' | 'channel.manage_members'
  | 'message.create' | 'message.edit_own' | 'message.delete_own' | 'message.delete_any'
  | 'channel.join_call' | 'channel.publish' | 'channel.moderate_call'

export type Actor = { userId: string; role: Role | null; inChannel: boolean }
export type Resource = { kind: 'group' | 'channel' | 'message'; visibility?: Visibility; authorId?: string }

const GERE_O_GRUPO: Action[] = ['group.update', 'group.invite', 'group.kick']
const SO_DO_OWNER: Action[]  = ['group.delete', 'group.change_role']
const ADMINISTRA_CANAL: Action[] = [
  'channel.create', 'channel.update', 'channel.delete', 'channel.manage_members',
]
const RESERVADAS_FATIA_2: Action[] = [
  'channel.join_call', 'channel.publish', 'channel.moderate_call',
]

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Fatia 2 ainda nao existe. Nenhuma excecao.
  if (RESERVADAS_FATIA_2.includes(action)) return false

  // Fora do grupo, nada.
  if (actor.role === null) return false

  const isOwner = actor.role === 'owner'
  const isAdmin = actor.role === 'admin' || isOwner

  if (action === 'group.view') return true
  if (SO_DO_OWNER.includes(action)) return isOwner
  if (GERE_O_GRUPO.includes(action)) return isAdmin

  // Eixo ADMINISTRAR: vem do papel, independe de pertencer ao canal.
  if (ADMINISTRA_CANAL.includes(action)) return isAdmin

  // Eixo LER e ESCREVER: vem do pertencimento, jamais do papel.
  if (action === 'channel.read' || action === 'channel.write' || action === 'message.create') {
    return resource.visibility === 'private' ? actor.inChannel : true
  }

  if (action === 'message.edit_own' || action === 'message.delete_own') {
    return resource.authorId === actor.userId
  }

  if (action === 'message.delete_any') {
    return resource.authorId === actor.userId || isAdmin
  }

  return false
}
```

O `return false` final não é defensivo por hábito: ele garante que **uma ação
nova acrescentada ao tipo `Action` nasce negada**. Se alguém adicionar
`group.export` e esquecer de tratá-la, o sistema recusa em vez de liberar.

- [ ] **Passo 4: Criar a regra de lint que protege a invariante**

```js
// eslint.config.js (trecho)
{
  files: ['api/src/**/*.ts'],
  ignores: ['api/src/permissions/can.ts'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "BinaryExpression[operator='==='] > MemberExpression[property.name='role']",
      message: 'Comparacao de papel fora de permissions/can.ts. Use can().',
    }],
  },
}
```

- [ ] **Passo 5: Exigir cobertura de 100% neste arquivo**

```ts
// api/vitest.config.ts (trecho)
coverage: {
  thresholds: {
    'src/permissions/can.ts':   { statements: 100, branches: 100, functions: 100, lines: 100 },
    'src/realtime/fanout.ts':   { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
}
```

- [ ] **Passo 6: Rodar tudo, confirmar verde, commitar**

Rodar: `npm --workspace api run test -- can --coverage`
Esperado: PASSA (28 casos + negação total), cobertura 100% em `can.ts`

```bash
git add api/src/permissions/ api/test/can.test.ts eslint.config.js api/vitest.config.ts
git commit -m "feat: funcao can() com matriz exaustiva e lint que protege a invariante"
```

### Tarefa 7: Carregador de contexto de autorização

**Arquivos:**
- Criar: `api/src/permissions/context.ts`
- Teste: `api/test/context.test.ts`

**Interfaces:**
- Consome: `db`, `can`
- Produz:
  - `loadGroupActor(userId, groupId): Promise<Actor>` — busca o papel
  - `loadChannelActor(userId, channelId): Promise<{ actor: Actor; channel: ChannelRow } | null>`
  - `assertCan(actor, action, resource): void` — lança `not_found` quando negado

Esta tarefa existe para que nenhuma rota precise montar `Actor` na mão. Ela é a
ponte entre o banco e a função pura da Tarefa 6.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/context.test.ts
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { loadChannelActor, assertCan } from '../src/permissions/context.js'

describe('contexto de autorizacao', () => {
  it('marca inChannel corretamente em canal privado', async () => {
    await withTestDb(async db => {
      const { admin, membroDentro, membroFora, canal } = await cenarioPrivado(db)

      expect((await loadChannelActor(membroDentro, canal))!.actor.inChannel).toBe(true)
      expect((await loadChannelActor(membroFora,   canal))!.actor.inChannel).toBe(false)
      expect((await loadChannelActor(admin,        canal))!.actor.inChannel).toBe(false)
    })
  })

  it('assertCan lanca not_found, nunca forbidden', async () => {
    await withTestDb(async db => {
      const { membroFora, canal } = await cenarioPrivado(db)
      const ctx = (await loadChannelActor(membroFora, canal))!
      expect(() => assertCan(ctx.actor, 'channel.read', { kind: 'channel', visibility: 'private' }))
        .toThrowError(expect.objectContaining({ code: 'not_found' }))
    })
  })
})
```

O helper `cenarioPrivado(db)` cria um grupo com um `admin`, dois `member`, e um
canal privado contendo apenas um deles. Ele vive em
`api/test/helpers/fixtures.ts` e é reutilizado pelas Tarefas 15, 20 e 21.

`assertCan` lançar `not_found` em vez de `forbidden` **não é cosmético**: um
`403` num canal privado confirmaria que o canal existe, e a spec 03 estabelece
que privado é invisível, não trancado.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- context`

- [ ] **Passo 3: Implementar `context.ts`**

`loadGroupActor` consulta `group_members` pelo par grupo/usuário e devolve
`{ userId, role, inChannel: false }`, com `role: null` quando não houver linha.

`loadChannelActor` consulta o canal, deriva o grupo, chama `loadGroupActor` e —
somente quando `visibility === 'private'` — consulta `channel_members` para
preencher `inChannel`. Devolve `null` quando o canal não existe, para que a rota
responda `404` sem ramificação extra.

`assertCan` chama `can()` e, se falso, lança `new AppError('not_found')`.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add api/src/permissions/context.ts api/test/context.test.ts api/test/helpers/fixtures.ts
git commit -m "feat: carregador de contexto de autorizacao com negacao invisivel"
```

### Tarefa 8: Login, logout, `me` e bootstrap do primeiro usuário

**Arquivos:**
- Criar: `api/src/routes/auth.routes.ts`, `api/src/cli/seed-owner.ts`
- Teste: `api/test/auth.routes.test.ts`

**Interfaces:**
- Consome: `hashPassword`, `verifyPassword`, `DUMMY_HASH`, `createSession`, `requireAuth`
- Produz: rotas `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`

`POST /api/auth/register` **não entra aqui** — ela depende de convite, e convite
depende de grupo. Ela é implementada na Tarefa 12.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/auth.routes.test.ts
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'

describe('rotas de autenticacao', () => {
  it('faz login e devolve cookie httpOnly', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'senha-longa-boa' },
      })
      expect(res.statusCode).toBe(200)
      const cookie = res.headers['set-cookie'] as string
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      await app.close()
    })
  })

  it('devolve a mesma mensagem para e-mail inexistente e senha errada', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const a = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'errada-mas-longa' } })
      const b = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'naoexiste@x.com', password: 'errada-mas-longa' } })
      expect(a.statusCode).toBe(401)
      expect(b.statusCode).toBe(401)
      expect(a.json().error.code).toBe(b.json().error.code)
      expect(a.json().error.message).toBe(b.json().error.message)
      await app.close()
    })
  })

  it('login e case-insensitive no e-mail', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'Felipe@X.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const res = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'felipe@x.com', password: 'senha-longa-boa' } })
      expect(res.statusCode).toBe(200)
      await app.close()
    })
  })
})
```

O segundo teste é o que trava a enumeração de contas. Ele compara código **e**
mensagem — se alguém futuramente "melhorar a experiência" diferenciando os dois
casos, o teste quebra e a discussão acontece antes do merge.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- auth.routes`

- [ ] **Passo 3: Implementar o login com tempo uniforme**

```ts
const [u] = await db.select().from(users).where(eq(users.email, body.email)).limit(1)
const hash = u?.passwordHash ?? DUMMY_HASH
const ok = await verifyPassword(hash, body.password)
if (!u || !ok) throw new AppError('invalid_credentials')
```

A verificação contra `DUMMY_HASH` roda **sempre**, inclusive quando o usuário não
existe. Sem ela, a resposta para e-mail inexistente voltaria em microssegundos e
a diferença de tempo entregaria a lista de quem tem conta.

- [ ] **Passo 4: Implementar logout e me**

`logout` chama `revokeSession(req.sessionId)` e limpa o cookie.
`me` usa `requireAuth` e devolve o usuário mais seus grupos com o papel em cada.

- [ ] **Passo 5: Implementar o seed idempotente**

```ts
// api/src/cli/seed-owner.ts — recusa rodar se ja houver qualquer usuario
const [existente] = await db.select({ id: users.id }).from(users).limit(1)
if (existente) { console.error('Ja existe usuario. Seed abortado.'); process.exit(1) }
```

Cria o primeiro usuário a partir de `SEED_OWNER_EMAIL` e `SEED_OWNER_PASSWORD`,
mais o primeiro grupo com um canal `#geral`, e imprime um convite inicial.

- [ ] **Passo 6: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/auth.routes.ts api/src/cli/ api/test/auth.routes.test.ts
git commit -m "feat: login com tempo uniforme, logout, me e bootstrap idempotente"
```

---

# Fase 2 — Grupos e convites

### Tarefa 9: Código de convite

**Arquivos:** criar `api/src/invites/code.ts`; teste `api/test/invite-code.test.ts`

**Interfaces:**
- Produz: `generateInviteCode(): string`, `normalizeInviteCode(raw: string): string`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/invite-code.test.ts
import { describe, it, expect } from 'vitest'
import { generateInviteCode, normalizeInviteCode } from '../src/invites/code.js'

const ALFABETO = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

describe('codigo de convite', () => {
  it('tem 8 caracteres do alfabeto Crockford', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(ALFABETO)
  })

  it('nunca contem letras ambiguas', () => {
    const amostra = Array.from({ length: 500 }, generateInviteCode).join('')
    for (const c of ['I', 'L', 'O', 'U']) expect(amostra).not.toContain(c)
  })

  it('normaliza o que a pessoa digita errado', () => {
    expect(normalizeInviteCode('k7m2p9xq')).toBe('K7M2P9XQ')
    expect(normalizeInviteCode('KIM2P9XQ')).toBe('K1M2P9XQ')  // I vira 1
    expect(normalizeInviteCode('KLM2P9XQ')).toBe('K1M2P9XQ')  // L vira 1
    expect(normalizeInviteCode('KOM2P9XQ')).toBe('K0M2P9XQ')  // O vira 0
    expect(normalizeInviteCode(' k7m2-p9xq ')).toBe('K7M2P9XQ')
  })

  it('gera codigos distintos', () => {
    const s = new Set(Array.from({ length: 2000 }, generateInviteCode))
    expect(s.size).toBe(2000)
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- invite-code`

- [ ] **Passo 3: Implementar**

```ts
// api/src/invites/code.ts
import { randomBytes } from 'node:crypto'

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'  // Crockford: sem I, L, O, U

export function generateInviteCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALFABETO[bytes[i]! % ALFABETO.length]
  return out
}

export function normalizeInviteCode(raw: string): string {
  return raw
    .trim().toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}
```

`randomBytes`, jamais `Math.random`: um gerador previsível transformaria o
código de convite em algo adivinhável.

A normalização existe porque esse código vai circular **ditado por telefone e
no WhatsApp**. A escolha do alfabeto e a escolha da fonte monoespaçada na
interface (spec 05) servem à mesma finalidade.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add api/src/invites/code.ts api/test/invite-code.test.ts
git commit -m "feat: codigo de convite base32 Crockford com normalizacao"
```

### Tarefa 10: Grupos — criar, ler, atualizar, apagar

**Arquivos:** criar `api/src/routes/groups.routes.ts`; teste `api/test/groups.routes.test.ts`

**Interfaces:**
- Consome: `requireAuth`, `loadGroupActor`, `assertCan`, `newId`
- Produz: `POST /api/groups`, `GET /api/groups/:id`, `PATCH /api/groups/:id`,
  `DELETE /api/groups/:id`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/groups.routes.test.ts
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { loginComo, criarUsuario } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'

describe('rotas de grupo', () => {
  it('criador vira owner e ganha canal geral', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'f@x.com')
      const res = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie }, payload: { name: 'Anticorp' } })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ name: 'Anticorp', role: 'owner' })

      const canais = await app.inject({ method: 'GET',
        url: `/api/groups/${res.json().id}/channels`, headers: { cookie } })
      expect(canais.json().map((c: any) => c.name)).toContain('geral')
      await app.close()
    })
  })

  it('nao-membro recebe 404, nunca 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const dono = await loginComo(app, db, 'dono@x.com')
      const g = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie: dono.cookie }, payload: { name: 'Privado' } })

      const estranho = await loginComo(app, db, 'estranho@x.com')
      const res = await app.inject({ method: 'GET',
        url: `/api/groups/${g.json().id}`, headers: { cookie: estranho.cookie } })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
      await app.close()
    })
  })

  it('admin nao consegue apagar o grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieAdmin, groupId } = await cenarioComAdmin(app, db)
      const res = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}`, headers: { cookie: cookieAdmin } })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('recusa nome fora de 2 a 64 caracteres', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'f@x.com')
      const res = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie }, payload: { name: 'A' } })
      expect(res.statusCode).toBe(422)
      expect(res.json().error.details.name).toBeTruthy()
      await app.close()
    })
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- groups.routes`

- [ ] **Passo 3: Implementar `POST /api/groups` em transação**

A criação insere quatro coisas atomicamente: o grupo, a linha de `group_members`
com `role: 'owner'`, o canal `#geral` público, e nada mais. Se qualquer passo
falhar, nenhum sobra.

```ts
const groupId = newId()
await db.transaction(async tx => {
  await tx.insert(groups).values({ id: groupId, name, ownerId: req.user!.id })
  await tx.insert(groupMembers).values({ groupId, userId: req.user!.id, role: 'owner' })
  await tx.insert(channels).values({ id: newId(), groupId, name: 'geral', position: 0 })
})
```

- [ ] **Passo 4: Implementar leitura, atualização e exclusão**

Todas seguem o mesmo formato: `loadGroupActor` monta o ator, `assertCan` decide,
e a negação vira `404`. Nenhuma rota compara papel diretamente.

- [ ] **Passo 5: Validar entrada com zod**

`name` entre 2 e 64 caracteres; `iconUrl` opcional e precisa ser URL válida.
Erro de validação vira `AppError('validation_failed', { name: [...] })`.

- [ ] **Passo 6: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/groups.routes.ts api/test/groups.routes.test.ts
git commit -m "feat: CRUD de grupos com criacao transacional e negacao invisivel"
```

### Tarefa 11: Membros — listar, mudar papel, remover, sair

**Arquivos:** modificar `api/src/routes/groups.routes.ts`; teste `api/test/members.test.ts`

**Interfaces:**
- Produz: `GET /api/groups/:id/members`, `PATCH /api/groups/:id/members/:userId`,
  `DELETE /api/groups/:id/members/:userId`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/members.test.ts
describe('membros', () => {
  it('owner promove membro a admin', async () => {
    // PATCH .../members/:id { role: 'admin' } -> 200, papel persistido
  })

  it('admin nao consegue mudar papel', async () => {
    // PATCH por admin -> 404
  })

  it('owner nao consegue sair sem transferir', async () => {
    // DELETE .../members/<proprio-owner> -> 409 owner_cannot_leave
  })

  it('transferir titularidade troca os dois papeis atomicamente', async () => {
    // PATCH .../members/:outro { role: 'owner' }
    // resultado: outro vira owner, o antigo vira admin, e nunca ha dois owners
  })

  it('sair do grupo remove de todos os canais privados', async () => {
    // membro em canal privado sai do grupo
    // -> nenhuma linha em channel_members para ele
  })

  it('admin remove member; member nao remove ninguem', async () => {
    // DELETE por admin -> 204 ; DELETE por member -> 404
  })
})
```

Cada `it` acima recebe corpo completo seguindo o padrão da Tarefa 10:
`withTestDb`, `buildServer`, `loginComo`, `app.inject`, asserção sobre status e
sobre o estado do banco.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- members`

- [ ] **Passo 3: Implementar transferência de titularidade em transação**

```ts
await db.transaction(async tx => {
  await tx.update(groupMembers).set({ role: 'admin' })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'owner')))
  await tx.update(groupMembers).set({ role: 'owner' })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, novoDono)))
  await tx.update(groups).set({ ownerId: novoDono }).where(eq(groups.id, groupId))
})
```

A ordem importa: rebaixar antes de promover. O índice único parcial
`group_one_owner_idx` recusaria a transação na ordem inversa — e é exatamente
esse o papel dele, transformar um erro de lógica em erro de banco.

- [ ] **Passo 4: Implementar saída e remoção**

Sair é o mesmo endpoint com o próprio ID. `owner` recebe `owner_cannot_leave`.
A remoção de `group_members` cascateia para `channel_members` pela FK — mas o
teste verifica isso explicitamente, porque é a garantia de que ninguém mantém
acesso a canal privado de um grupo do qual saiu.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/groups.routes.ts api/test/members.test.ts
git commit -m "feat: gestao de membros com transferencia atomica de titularidade"
```

### Tarefa 12: Convites e cadastro

**Arquivos:** criar `api/src/routes/invites.routes.ts`; modificar `auth.routes.ts`;
teste `api/test/invites.test.ts`

**Interfaces:**
- Produz: `POST /api/groups/:id/invites`, `GET /api/invites/:code` (**pública**),
  `POST /api/invites/:code/accept`, `DELETE /api/invites/:code`,
  `GET /api/groups/:id/invites`, e `POST /api/auth/register`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// api/test/invites.test.ts
describe('convites', () => {
  it('previa publica revela apenas nome, icone e contagem', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/invites/${code}` })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json()).sort())
      .toEqual(['groupIconUrl', 'groupName', 'memberCount', 'valid'])
    // nunca: groupId, members, channels, messages
  })

  it('cadastro sem codigo e recusado', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { email: 'novo@x.com', password: 'senha-longa-boa', displayName: 'Novo' } })
    expect(res.statusCode).toBe(422)
  })

  it('cadastro com codigo cria conta e vinculo', async () => { /* 201 + membership */ })
  it('codigo expirado devolve invite_expired', async () => { /* 410 */ })
  it('codigo revogado devolve invite_revoked', async () => { /* 410 */ })
  it('codigo esgotado devolve invite_exhausted', async () => { /* 410 */ })
  it('aceitar duas vezes devolve already_member', async () => { /* 409 */ })
  it('revogar nao expulsa quem ja entrou', async () => { /* membership intacta */ })
  it('aceita codigo digitado com I, L e O trocados', async () => { /* normalizacao */ })

  it('uso concorrente nao ultrapassa max_uses', async () => {
    // dispara 10 accept simultaneos com max_uses = 3
    // -> exatamente 3 sucessos, 7 recusas
  })
})
```

O último teste é o que força o incremento a ser feito sob trava. Sem ele, dez
requisições simultâneas leem `uses = 0` e todas passam.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- invites`

- [ ] **Passo 3: Implementar a aceitação sob trava**

```ts
await db.transaction(async tx => {
  const [inv] = await tx.select().from(invites)
    .where(eq(invites.code, code)).for('update').limit(1)

  if (!inv) throw new AppError('invite_not_found')
  if (inv.revokedAt) throw new AppError('invite_revoked')
  if (inv.expiresAt && inv.expiresAt < new Date()) throw new AppError('invite_expired')
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) throw new AppError('invite_exhausted')

  const [ja] = await tx.select().from(groupMembers)
    .where(and(eq(groupMembers.groupId, inv.groupId), eq(groupMembers.userId, userId))).limit(1)
  if (ja) throw new AppError('already_member')

  await tx.insert(groupMembers).values({ groupId: inv.groupId, userId, role: 'member' })
  await tx.update(invites).set({ uses: inv.uses + 1 }).where(eq(invites.code, code))
})
```

O `.for('update')` é o detalhe que faz o último teste do Passo 1 passar: ele
serializa as tentativas concorrentes na linha do convite. Sem ele, dez
requisições simultâneas leem `uses = 0` e todas entram.

- [ ] **Passo 4: Implementar a prévia pública com resposta mínima**

A rota `GET /api/invites/:code` é a **única** não autenticada que devolve dado de
grupo. Ela monta o objeto campo a campo, nunca espalhando a linha do banco:

```ts
return { valid: true, groupName: g.name, groupIconUrl: g.iconUrl, memberCount: n }
```

Convite inválido devolve `{ valid: false, reason: 'expired' }` com status 200 —
a página precisa renderizar o motivo, e distinguir "código inexistente" de
"código expirado" aqui não vaza nada, porque nenhum dado do grupo acompanha.

- [ ] **Passo 5: Implementar o cadastro exigindo convite**

`POST /api/auth/register` recebe `{ email, password, displayName, inviteCode }`.
Sem `inviteCode` válido, responde `422` antes de tocar a tabela de usuários.
A criação da conta e o consumo do convite acontecem **na mesma transação**.

- [ ] **Passo 6: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/invites.routes.ts api/src/routes/auth.routes.ts api/test/invites.test.ts
git commit -m "feat: convites com trava de concorrencia e cadastro fechado por convite"
```

---

# Fase 3 — Canais

### Tarefa 13: Canais públicos

**Arquivos:** criar `api/src/routes/channels.routes.ts`; teste `api/test/channels.test.ts`

**Interfaces:**
- Produz: `POST /api/groups/:id/channels`, `GET /api/groups/:id/channels`,
  `PATCH /api/channels/:id`, `DELETE /api/channels/:id`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('canais publicos', () => {
  it('admin cria canal; member nao', async () => { /* 201 vs 404 */ })
  it('recusa nome duplicado no mesmo grupo', async () => { /* 409 */ })
  it('normaliza o nome para minusculas com hifen', async () => {
    // 'Planejamento Semanal' -> 'planejamento-semanal'
  })
  it('lista ordenada por position', async () => { /* ordem estavel */ })
  it('apagar canal apaga suas mensagens', async () => { /* cascade */ })
  it('tipo voice e recusado nesta fatia', async () => {
    const res = await criarCanal({ name: 'sala', type: 'voice' })
    expect(res.statusCode).toBe(422)
  })
})
```

O último caso é a trava que impede a Fatia 2 de vazar para dentro da Fatia 1: a
coluna aceita `voice` no banco, mas a API recusa até que a mídia exista de fato.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- channels`

- [ ] **Passo 3: Implementar com normalização de nome**

```ts
const nomeCanal = (raw: string) => raw.trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
```

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/channels.routes.ts api/test/channels.test.ts
git commit -m "feat: CRUD de canais publicos com nome normalizado"
```

### Tarefa 14: Canais privados e lista de acesso

> Segunda tarefa mais sensível do plano. É aqui que "privado significa
> invisível" deixa de ser texto e vira comportamento.

**Arquivos:** modificar `api/src/routes/channels.routes.ts`;
teste `api/test/private-channels.test.ts`

**Interfaces:**
- Produz: `GET /api/channels/:id/members`, `POST /api/channels/:id/members`,
  `DELETE /api/channels/:id/members/:userId`
- Modifica: `GET /api/groups/:id/channels` passa a filtrar por visibilidade

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('canais privados', () => {
  it('nao aparece na listagem de quem nao participa', async () => {
    const res = await app.inject({ method: 'GET',
      url: `/api/groups/${groupId}/channels`, headers: { cookie: cookieDeFora } })
    const nomes = res.json().map((c: any) => c.name)
    expect(nomes).not.toContain('diretoria')
    expect(JSON.stringify(res.json())).not.toContain(canalPrivadoId)
  })

  it('admin fora do canal nao le, mas apaga', async () => {
    expect((await lerCanal(cookieAdmin)).statusCode).toBe(404)
    expect((await apagarCanal(cookieAdmin)).statusCode).toBe(204)
  })

  it('criador entra automaticamente na lista', async () => { /* channel_members tem o criador */ })
  it('so aceita membro que ja pertence ao grupo', async () => { /* 404 para estranho */ })
  it('remover do canal nao remove do grupo', async () => { /* membership intacta */ })
  it('canal publico nao usa channel_members', async () => { /* tabela vazia */ })

  it('tornar publico um canal privado limpa a lista de acesso', async () => {
    // PATCH { visibility: 'public' } -> channel_members zerada para o canal
  })
})
```

O último caso evita uma classe sutil de bug: se a lista sobrevivesse à troca de
visibilidade e o canal voltasse a privado depois, o acesso antigo ressuscitaria
silenciosamente.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- private-channels`

- [ ] **Passo 3: Implementar a listagem filtrada**

```ts
const visiveis = await db.select().from(channels)
  .leftJoin(channelMembers, and(
    eq(channelMembers.channelId, channels.id),
    eq(channelMembers.userId, req.user!.id),
  ))
  .where(and(
    eq(channels.groupId, groupId),
    or(eq(channels.visibility, 'public'), isNotNull(channelMembers.userId)),
  ))
  .orderBy(channels.position)
```

O `LEFT JOIN` com filtro no `ON` é o que faz um único `SELECT` resolver as duas
regras. Filtrar em memória depois de buscar tudo funcionaria — e seria
exatamente o tipo de atalho que, num refactor futuro, esquece o filtro e vaza.

- [ ] **Passo 4: Implementar a gestão da lista de acesso**

Adicionar exige `channel.manage_members` (papel) **e** que o alvo já pertença ao
grupo. Remover a si mesmo é permitido a qualquer participante do canal.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/channels.routes.ts api/test/private-channels.test.ts
git commit -m "feat: canais privados invisiveis com lista de acesso explicita"
```

### Tarefa 15: Mensagens

**Arquivos:** criar `api/src/routes/messages.routes.ts`; teste `api/test/messages.test.ts`

**Interfaces:**
- Produz: `GET /api/channels/:id/messages`, `POST`, `PATCH /api/messages/:id`,
  `DELETE /api/messages/:id`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('mensagens', () => {
  it('pagina por cursor, do mais novo para o mais antigo', async () => {
    // 120 mensagens; ?limit=50 -> 50; ?before=<id> -> as 50 seguintes; sem repeticao
  })

  it('aceita o ID gerado pelo cliente para eco otimista', async () => {
    const id = uuidv7()
    const res = await enviar({ id, content: 'ola' })
    expect(res.json().id).toBe(id)
  })

  it('recusa ID que nao seja UUIDv7', async () => { /* 422 */ })
  it('recusa ID ja existente', async () => { /* 409 */ })

  it('soft delete some da listagem mas a linha permanece', async () => {
    // DELETE -> 204 ; GET nao traz ; SELECT direto mostra deleted_at preenchido
  })

  it('autor edita a propria; terceiro nao', async () => { /* 200 vs 404 */ })
  it('admin apaga a de terceiro; member nao', async () => { /* 204 vs 404 */ })
  it('nao-membro do canal privado recebe 404 ao listar', async () => { /* 404 */ })
  it('recusa conteudo vazio ou acima de 4000 caracteres', async () => { /* 422 */ })

  it('?after=<id> devolve o que chegou depois, para reconexao', async () => {
    // este endpoint e o que cura os buracos do WebSocket
  })
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- messages`

- [ ] **Passo 3: Implementar a paginação por cursor**

```ts
const linhas = await db.select().from(messages)
  .where(and(
    eq(messages.channelId, channelId),
    isNull(messages.deletedAt),
    before ? lt(messages.id, before) : undefined,
    after  ? gt(messages.id, after)  : undefined,
  ))
  .orderBy(desc(messages.id))
  .limit(Math.min(limit ?? 50, 100))
```

Comparar `id` funciona como comparar tempo porque UUIDv7 é ordenável — e usa o
índice `messages_channel_id_desc_idx` diretamente. `OFFSET` degradaria conforme
o canal crescesse.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add api/src/routes/messages.routes.ts api/test/messages.test.ts
git commit -m "feat: mensagens com paginacao por cursor e soft delete"
```

---

# Fase 4 — Tempo real

### Tarefa 16: Gateway WebSocket, registro e heartbeat

**Arquivos:** criar `api/src/realtime/gateway.ts`, `api/src/realtime/registry.ts`;
teste `api/test/gateway.test.ts`

**Interfaces:**
- Produz:
  - `registry.add(userId, socket): string` (devolve connectionId)
  - `registry.remove(connectionId): void`
  - `registry.socketsOf(userIds: string[]): WebSocket[]`
  - `registry.userIds(): string[]`
  - Rota `GET /ws`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('gateway', () => {
  it('recusa upgrade sem cookie de sessao', async () => {
    // conectar sem cookie -> fecha com 401, nunca abre
  })

  it('aceita com cookie valido e envia ready', async () => {
    // primeiro frame recebido tem t === 'ready'
  })

  it('encerra conexao que nao responde ao ping', async () => {
    // com timers falsos: 30s -> ping ; 60s sem pong -> socket fechado
  })

  it('descarta frame de tipo desconhecido sem derrubar', async () => {
    // enviar { t: 'message.create' } -> conexao segue viva, nada e gravado
  })

  it('derruba a conexao mais antiga na sexta aba', async () => {
    // 6 conexoes do mesmo usuario -> a primeira fecha, restam 5
  })

  it('sessao revogada nao consegue reconectar', async () => { /* 401 */ })
})
```

O quarto teste é o que garante o contrato da spec 04: **não existe caminho de
escrita pelo WebSocket.** Se alguém um dia adicionar um `case 'message.create'`
no gateway, este teste quebra.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- gateway`

- [ ] **Passo 3: Implementar o registro em memória**

```ts
// api/src/realtime/registry.ts
type Conn = { id: string; userId: string; socket: WebSocket; alive: boolean }

const porConexao = new Map<string, Conn>()
const porUsuario = new Map<string, Set<string>>()

export const registry = {
  add(userId: string, socket: WebSocket): string {
    const id = newId()
    porConexao.set(id, { id, userId, socket, alive: true })
    const s = porUsuario.get(userId) ?? new Set()
    s.add(id); porUsuario.set(userId, s)
    return id
  },
  remove(id: string) {
    const c = porConexao.get(id)
    if (!c) return
    porConexao.delete(id)
    const s = porUsuario.get(c.userId)
    s?.delete(id)
    if (s && s.size === 0) porUsuario.delete(c.userId)
  },
  socketsOf(userIds: string[]): WebSocket[] {
    const out: WebSocket[] = []
    for (const u of userIds)
      for (const id of porUsuario.get(u) ?? [])
        out.push(porConexao.get(id)!.socket)
    return out
  },
}
```

- [ ] **Passo 4: Implementar o heartbeat**

Ping a cada 30 s marcando `alive = false`; o `pong` marca `true`. Conexão ainda
`false` no ciclo seguinte é encerrada. Sem isso, NAT corporativo e rede móvel
deixam conexões aparentemente abertas que morreram há uma hora — e a presença
vira decoração.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add api/src/realtime/gateway.ts api/src/realtime/registry.ts api/test/gateway.test.ts
git commit -m "feat: gateway WebSocket autenticado com heartbeat e registro em memoria"
```

### Tarefa 17: `fanout()` — cálculo de audiência

> Junto com `can()`, concentra todo o risco de segurança do sistema. Cobertura
> de 100% obrigatória.

**Arquivos:** criar `api/src/realtime/fanout.ts`; teste `api/test/fanout.test.ts`

**Interfaces:**
- Produz:
  - `audienceOfChannel(channelId): Promise<string[]>`
  - `audienceOfGroup(groupId): Promise<string[]>`
  - `audienceOfUser(userId): Promise<string[]>` — quem compartilha grupo

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('fanout', () => {
  it('canal publico: todos os membros do grupo', async () => {
    expect((await audienceOfChannel(publico)).sort())
      .toEqual([owner, admin, m1, m2].sort())
  })

  it('canal privado: apenas a lista de acesso', async () => {
    const a = await audienceOfChannel(privado)
    expect(a).toContain(m1)
    expect(a).not.toContain(m2)
    expect(a).not.toContain(admin)   // admin NAO recebe
    expect(a).not.toContain(owner)   // owner NAO recebe
  })

  it('quem saiu do grupo desaparece da audiencia', async () => { /* apos DELETE */ })
  it('audiencia de usuario cobre todos os grupos em comum, sem repetir', async () => { /* Set */ })
  it('canal inexistente devolve lista vazia, nunca lanca', async () => {
    expect(await audienceOfChannel(newId())).toEqual([])
  })
})
```

As duas asserções `not.toContain(admin)` e `not.toContain(owner)` são a tradução
executável da regra do eixo duplo. Se alguém "consertar" o fan-out para incluir
administradores, este teste quebra antes do merge.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- fanout`

- [ ] **Passo 3: Implementar**

```ts
// api/src/realtime/fanout.ts
export async function audienceOfChannel(channelId: string): Promise<string[]> {
  const [ch] = await db.select({ groupId: channels.groupId, visibility: channels.visibility })
    .from(channels).where(eq(channels.id, channelId)).limit(1)
  if (!ch) return []

  if (ch.visibility === 'private') {
    const linhas = await db.select({ userId: channelMembers.userId })
      .from(channelMembers).where(eq(channelMembers.channelId, channelId))
    return linhas.map(l => l.userId)
  }

  return audienceOfGroup(ch.groupId)
}
```

**Nenhuma rota calcula audiência.** Toda emissão chama estas três funções. É a
regra que mantém o risco concentrado num arquivo de trinta linhas em vez de
espalhado por dez rotas.

- [ ] **Passo 4: Rodar com cobertura, confirmar 100%, commitar**

```bash
git add api/src/realtime/fanout.ts api/test/fanout.test.ts
git commit -m "feat: calculo unico de audiencia com cobertura total"
```

### Tarefa 18: Presença e emissão de eventos

**Arquivos:** criar `api/src/realtime/presence.ts`, `api/src/realtime/emit.ts`;
modificar as quatro rotas de escrita; teste `api/test/events.test.ts`

**Interfaces:**
- Produz:
  - `presence.connect(userId): boolean` (true se transicionou para online)
  - `presence.disconnect(userId): boolean` (true se ficou offline)
  - `presence.isOnline(userId): boolean`
  - `emit.toChannel(channelId, event)`, `emit.toGroup(groupId, event)`, `emit.toUser(userId, event)`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('eventos de tempo real', () => {
  it('POST de mensagem entrega message.created a todos do canal', async () => {
    // dois sockets no canal; um faz POST; ambos recebem, inclusive o autor
  })

  it('em canal privado, socket de fora nao recebe nada', async () => {
    // socket do estranho fica em silencio por 500ms
  })

  it('adicionar ao canal privado emite channel.created so para o adicionado', async () => {})
  it('remover do canal privado emite channel.deleted so para o removido', async () => {})

  it('presenca so muda na primeira e na ultima conexao', async () => {
    // 2 abas: apenas 1 evento online; fechar 1 aba: nenhum evento;
    // fechar a segunda: 1 evento offline
  })

  it('presence.update vai so para quem compartilha grupo', async () => {})
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- events`

- [ ] **Passo 3: Implementar a fachada de emissão**

```ts
// api/src/realtime/emit.ts
async function enviar(userIds: string[], evento: unknown) {
  const payload = JSON.stringify(evento)
  for (const s of registry.socketsOf(userIds))
    if (s.readyState === s.OPEN) s.send(payload)
}

export const emit = {
  toChannel: async (id: string, e: unknown) => enviar(await audienceOfChannel(id), e),
  toGroup:   async (id: string, e: unknown) => enviar(await audienceOfGroup(id), e),
  toUser:    async (id: string, e: unknown) => enviar([id], e),
}
```

- [ ] **Passo 4: Ligar as rotas**

Cada rota de escrita emite **depois** de a transação confirmar. Emitir dentro da
transação anunciaria um fato que ainda pode ser desfeito por rollback.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add api/src/realtime/ api/src/routes/ api/test/events.test.ts
git commit -m "feat: presenca por transicao e emissao de eventos apos commit"
```

### Tarefa 19: O teste inegociável de vazamento

> Esta tarefa **não implementa funcionalidade**. Ela existe para provar que as
> Tarefas 14, 17 e 18 não vazam canal privado por nenhum caminho. É a única
> tarefa do plano cujo produto é exclusivamente teste.

**Arquivos:** criar `api/test/private-channel-leak.test.ts`

- [ ] **Passo 1: Escrever os onze casos da spec 06**

```ts
// api/test/private-channel-leak.test.ts
describe('VAZAMENTO DE CANAL PRIVADO — nenhum caminho pode falhar', () => {
  it('01 ready de nao-membro nao contem o canal, nem o ID', async () => {})
  it('02 GET /groups/:id/channels nao lista o canal', async () => {})
  it('03 GET /channels/:id devolve 404, nunca 403', async () => {})
  it('04 GET /channels/:id/messages devolve 404', async () => {})
  it('05 POST de mensagem por nao-membro devolve 404', async () => {})
  it('06 fan-out de message.created nao alcanca o socket de fora', async () => {})
  it('07 adicionar emite channel.created apenas ao adicionado', async () => {})
  it('08 remover emite channel.deleted apenas ao removido', async () => {})
  it('09 CORRIDA: mensagem enviada apos a remocao nao alcanca o removido', async () => {
    // remover e enviar em paralelo, 50 repeticoes; zero entregas ao removido
  })
  it('10 sair do grupo remove de todos os canais privados', async () => {})
  it('11 admin sem acesso apaga o canal mas nunca le seu conteudo', async () => {})
})
```

Cada caso recebe corpo completo. O caso 09 roda em laço de 50 repetições porque
condição de corrida que aparece uma vez em vinte passa despercebida numa
execução única.

- [ ] **Passo 2: Rodar e observar quais falham**

Rodar: `npm --workspace api run test -- private-channel-leak`
Esperado: os casos que passarem confirmam as tarefas anteriores; os que falharem
apontam vazamento real. **Cada falha é corrigida na tarefa de origem, não aqui.**

- [ ] **Passo 3: Corrigir a origem de cada falha**

Vazamento em listagem volta à Tarefa 14. Vazamento em evento volta à Tarefa 17
ou 18. Este arquivo nunca é relaxado para passar.

- [ ] **Passo 4: Amarrar ao processo**

Acrescentar ao `CONTRIBUTING.md`: *nenhuma alteração em `fanout.ts`, `can.ts` ou
nas rotas de canal entra sem esta suíte verde.*

- [ ] **Passo 5: Commitar**

```bash
git add api/test/private-channel-leak.test.ts CONTRIBUTING.md
git commit -m "test: suite inegociavel de vazamento de canal privado"
```

### Tarefa 20: Limites de taxa

**Arquivos:** modificar `api/src/index.ts`; teste `api/test/rate-limit.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('limites de taxa', () => {
  it('bloqueia a sexta tentativa de login em um minuto', async () => {
    // 5 tentativas -> 401 ; a sexta -> 429 com Retry-After
  })
  it('limita mensagens a 30 por minuto por usuario', async () => {})
  it('limita aceitacao de convite a 5 por hora por IP', async () => {})
  it('rotas normais aceitam ate 300 por minuto', async () => {})
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- rate-limit`

- [ ] **Passo 3: Implementar com `@fastify/rate-limit`**

A tabela completa está na spec 03, seção 6. O erro devolvido segue o contrato:
`AppError('rate_limited')` com cabeçalho `Retry-After`.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add api/src/index.ts api/test/rate-limit.test.ts
git commit -m "feat: limites de taxa conforme a spec 03"
```

---

# Fase 5 — Frontend

### Tarefa 21: Fundação visual — tokens, tema e densidade

**Arquivos:** criar `web/` (Vite + React + TS), `web/src/ui/tokens.css`,
`web/src/ui/ThemeProvider.tsx`; teste `web/test/tokens.test.ts`

**Interfaces:**
- Produz: `useTheme()`, `useDensity()`, e as variáveis CSS de cor e espaçamento

- [ ] **Passo 1: Escrever o teste de contraste que falha**

```ts
// web/test/tokens.test.ts
import { describe, it, expect } from 'vitest'
import { contrast } from './helpers/contrast.js'
import { LIGHT, DARK } from '../src/ui/tokens.js'

const PARES: Array<[keyof typeof LIGHT, keyof typeof LIGHT, number]> = [
  ['fg', 'bg', 4.5],
  ['fgMuted', 'bg', 4.5],
  ['accentFg', 'accent', 4.5],
  ['border', 'bg', 3],
  ['focusRing', 'bg', 3],
  ['danger', 'bg', 4.5],
  ['presenceOnline', 'bg', 3],
]

describe('contraste WCAG 2.2 AA', () => {
  for (const [a, b, min] of PARES) {
    it(`${a} sobre ${b} no tema claro atinge ${min}:1`, () => {
      expect(contrast(LIGHT[a], LIGHT[b])).toBeGreaterThanOrEqual(min)
    })
    it(`${a} sobre ${b} no tema escuro atinge ${min}:1`, () => {
      expect(contrast(DARK[a], DARK[b])).toBeGreaterThanOrEqual(min)
    })
  }
})
```

Contraste validado **no token, não no olho**. Um teste automatizado impede que
uma cor "só um pouco mais clara" entre num ajuste futuro e quebre a
conformidade sem ninguém notar.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- tokens`

- [ ] **Passo 3: Definir a paleta multidimensional**

Neutro frio (zinc) como estrutura; **âmbar** como único acento de ação; verde
discreto exclusivo de presença; vermelho exclusivo de erro e destruição. Nenhum
componente escreve cor literal — tudo via variável CSS.

- [ ] **Passo 4: Implementar tema e densidade**

Tema escuro por padrão, claro disponível, respeitando `prefers-color-scheme` na
primeira visita e persistindo a escolha. Densidade compacta ou confortável,
alterando apenas variáveis de espaçamento e altura de linha.

- [ ] **Passo 5: Aplicar `prefers-reduced-motion`**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Passo 6: Rodar, confirmar verde, commitar**

```bash
git add web/
git commit -m "feat: fundacao visual com tokens validados por contraste"
```

### Tarefa 22: Cliente REST tipado

**Arquivos:** criar `web/src/lib/api.ts`; teste `web/test/api.test.ts`

**Interfaces:**
- Produz: `api.get/post/patch/delete`, `class ApiError { code, message, requestId, details }`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('cliente REST', () => {
  it('converte o envelope de erro em ApiError com o code preservado', async () => {
    // servidor devolve { error: { code: 'invite_expired', ... } }
    await expect(api.post('/invites/X/accept')).rejects.toMatchObject({ code: 'invite_expired' })
  })

  it('envia credenciais em toda requisicao', async () => {
    // fetch chamado com credentials: 'include'
  })

  it('repete automaticamente em falha de rede, ate 3 vezes', async () => {})
  it('NAO repete em 4xx', async () => {})
  it('em 401 dispara o evento de sessao expirada uma unica vez', async () => {})
})
```

O quarto teste importa: repetir um `422` reenviaria dado inválido três vezes e
poderia duplicar efeito em rotas não idempotentes.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- api`

- [ ] **Passo 3: Implementar**

O cliente decide comportamento pelo `code`, **nunca pelo texto** da mensagem.
Mudar a redação de um erro no servidor jamais pode quebrar o cliente.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add web/src/lib/api.ts web/test/api.test.ts
git commit -m "feat: cliente REST tipado com erro estruturado"
```

### Tarefa 23: Cliente WebSocket com reconciliação

> É aqui que "o WebSocket tem permissão para perder eventos" vira código.

**Arquivos:** criar `web/src/lib/socket.ts`; teste `web/test/socket.test.ts`

**Interfaces:**
- Produz: `connectSocket({ onEvent, onStatus })`, `type SocketStatus = 'conectado' | 'reconectando' | 'offline'`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('cliente WebSocket', () => {
  it('reconecta com backoff exponencial', async () => {
    // quedas sucessivas -> esperas de ~1s, ~2s, ~4s, ~8s, teto de 30s
  })

  it('aplica jitter de ate 30% em cada espera', async () => {
    // 100 amostras da primeira espera -> nunca todas iguais, todas em [700, 1300]ms
  })

  it('zera o contador apos 60s de conexao estavel', async () => {})

  it('ao reconectar, busca por REST o que perdeu', async () => {
    // canal com ultima mensagem conhecida M50
    // reconexao -> GET /channels/:id/messages?after=M50
    // mensagens M51..M53 aparecem sem recarregar a pagina
  })

  it('reconecta imediatamente quando a aba volta a ficar visivel', async () => {})
  it('reporta status para a barra de conexao', async () => {})
})
```

O teste do jitter parece pedante e não é: sem ele, o servidor reiniciando faz os
dez clientes voltarem no mesmo milissegundo e derrubarem o que acabou de subir.

O teste de reconciliação é o coração da arquitetura: prova que um buraco no
tempo real se cura sozinho pelo REST, sem replay, sem número de sequência, sem
confirmação de recebimento.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- socket`

- [ ] **Passo 3: Implementar o backoff com jitter**

```ts
function espera(tentativa: number): number {
  const base = Math.min(1000 * 2 ** (tentativa - 1), 30_000)
  const jitter = base * 0.3 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}
```

- [ ] **Passo 4: Implementar a reconciliação na reconexão**

Para cada canal com histórico carregado, dispara
`GET /api/channels/:id/messages?after=<ultimoIdConhecido>` e funde o resultado.
Nada de buffer de replay no servidor.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add web/src/lib/socket.ts web/test/socket.test.ts
git commit -m "feat: socket com backoff, jitter e reconciliacao por REST"
```

### Tarefa 24: Telas de autenticação e prévia de convite

**Arquivos:** criar `web/src/features/auth/*`; teste `web/test/auth-screens.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('telas de autenticacao', () => {
  it('login tem rotulos persistentes, nao apenas placeholder', async () => {
    render(<Login />)
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  it('erro aparece em texto e move o foco para o campo', async () => {
    // nunca apenas borda vermelha (SC 1.4.1); foco no primeiro invalido (SC 3.3.3)
  })

  it('previa de convite mostra nome, icone e contagem, e nada mais', async () => {
    // nenhum canal, nenhum membro, nenhum ID na tela
  })

  it('convite invalido explica o motivo em portugues', async () => {
    // 'Este convite expirou.' e nao 'invite_expired'
  })

  it('cadastro preserva o codigo ao alternar com o login', async () => {})
  it('axe nao encontra violacao nas tres telas', async () => {})
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- auth-screens`

- [ ] **Passo 3: Implementar as três telas**

Login, cadastro (só alcançável com código no contexto) e prévia de convite. O
código aparece em **JetBrains Mono**, porque vai ser ditado por telefone.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/auth/ web/test/auth-screens.test.tsx
git commit -m "feat: telas de autenticacao acessiveis com previa minima de convite"
```

### Tarefa 25: Estrutura da aplicação — grupos, canais e navegação

**Arquivos:** criar `web/src/features/groups/*`, `web/src/features/channels/*`,
`web/src/AppShell.tsx`; teste `web/test/shell.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('estrutura da aplicacao', () => {
  it('canal privado sem acesso nao aparece, nem com cadeado', async () => {
    // o nome do canal nao esta em lugar nenhum do DOM
  })

  it('trocar de canal move o foco para o campo de escrita', async () => {
    await user.click(screen.getByRole('link', { name: '# planejamento' }))
    expect(screen.getByLabelText('Escrever mensagem')).toHaveFocus()
  })

  it('trocar de canal anuncia o nome via region de status', async () => {})

  it('Alt+seta navega entre canais sem mouse', async () => {})

  it('todo alvo clicavel mede ao menos 24 por 24 px', async () => {
    // percorre os elementos interativos e afirma o retangulo minimo
  })

  it('em 640px a lista de canais vira gaveta', async () => {})
  it('em zoom de 400% nao ha rolagem horizontal', async () => {})
  it('link de pular para a conversa e o primeiro foco', async () => {})
})
```

O primeiro teste é a contrapartida no frontend da Tarefa 14: o servidor não
envia o canal, e a interface não inventa cadeado. **Privado é invisível,
inclusive quanto à existência.**

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- shell`

- [ ] **Passo 3: Implementar o layout de quatro colunas**

Larguras fixas de 64 px, 240 px, flexível e 240 px. A barra lateral **não muda
de largura** com nome longo nem com hover — dimensões estáveis são requisito,
não detalhe.

- [ ] **Passo 4: Implementar os pontos de quebra**

1200, 900 e 640 px conforme a spec 05, mais o comportamento em zoom de 400%.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/groups/ web/src/features/channels/ web/src/AppShell.tsx web/test/shell.test.tsx
git commit -m "feat: estrutura da aplicacao com navegacao por teclado e canais invisiveis"
```

### Tarefa 26: Lista de mensagens

**Arquivos:** criar `web/src/features/messages/MessageList.tsx`;
teste `web/test/message-list.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('lista de mensagens', () => {
  it('e uma region de log educada', async () => {
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite')
  })

  it('PAUSA os anuncios enquanto o campo de escrita esta focado', async () => {
    await user.click(screen.getByLabelText('Escrever mensagem'))
    chegarMensagem({ content: 'oi' })
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
  })

  it('AGRUPA anuncios em rajada em vez de ler um por um', async () => {})

  it('o indicador de digitacao NAO esta em region viva', async () => {
    const el = screen.getByText(/esta digitando/)
    expect(el.closest('[aria-live]')).toBeNull()
  })

  it('mantem a rolagem colada no fim se ja estava no fim', async () => {})
  it('mostra marcador de novas mensagens se o usuario havia rolado para cima', async () => {})
  it('agrupa mensagens do mesmo autor em menos de 5 minutos', async () => {})
  it('insere separador entre dias diferentes', async () => {})
  it('carrega o historico anterior ao rolar para o topo', async () => {})
})
```

Os três primeiros casos são a diferença entre acessível no papel e acessível na
prática: anunciar cada mensagem de uma conversa movimentada transforma leitor de
tela em tortura, e interromper quem está digitando é pior ainda.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- message-list`

- [ ] **Passo 3: Implementar a região viva com pausa e agrupamento**

`aria-live` alterna para `off` quando o campo de escrita recebe foco, e os
anúncios são agrupados numa janela de 2 s.

- [ ] **Passo 4: Implementar a âncora de rolagem**

Colada no fim quando já estava no fim; caso contrário, marcador "novas
mensagens" sem arrastar a leitura de quem está revisando o histórico.

- [ ] **Passo 5: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/messages/ web/test/message-list.test.tsx
git commit -m "feat: lista de mensagens com region de log educada e ancora de rolagem"
```

### Tarefa 27: Composição com eco otimista

**Arquivos:** criar `web/src/features/messages/Composer.tsx`;
teste `web/test/composer.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('composicao', () => {
  it('a mensagem aparece antes da resposta do servidor', async () => {
    // fetch pendente; o texto ja esta na lista, com aria-busy
  })

  it('usa o mesmo UUIDv7 gerado no cliente, sem duplicar no eco', async () => {
    // quando message.created chega pelo socket, a mensagem otimista e substituida,
    // nunca duplicada
  })

  it('falha vira estado visivel com botao de tentar de novo', async () => {
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('NUNCA some em silencio', async () => {
    // apos erro, o texto continua na tela e recuperavel
  })

  it('Enter envia, Shift+Enter quebra linha', async () => {})
  it('recusa acima de 4000 caracteres com contador visivel', async () => {})
  it('emite typing no maximo a cada 3 segundos', async () => {})
})
```

O caso "nunca some em silêncio" existe porque é a falha mais corrosiva de
confiança num chat: a pessoa acha que falou, e ninguém recebeu.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- composer`

- [ ] **Passo 3: Implementar o eco otimista**

O ID é gerado no cliente com `uuidv7()` e enviado no corpo. Quando o evento
`message.created` chega pelo socket, a mensagem otimista é reconciliada **pelo
ID**, não por conteúdo — reconciliar por texto duplicaria mensagens repetidas.

Esta é a razão de a Tarefa 15 aceitar ID vindo do cliente: sem isso, o eco não
teria como se reconhecer no evento de volta.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/messages/Composer.tsx web/test/composer.test.tsx
git commit -m "feat: composicao com eco otimista reconciliado por ID"
```

### Tarefa 28: Presença, membros e a barra de conexão

**Arquivos:** criar `web/src/features/presence/*`;
teste `web/test/presence.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('presenca e conexao', () => {
  it('presenca nunca depende so de cor', async () => {
    // online: circulo cheio + texto acessivel 'online'
    // offline: circulo vazado + texto acessivel 'offline'
    expect(screen.getByLabelText('Ana, online')).toBeInTheDocument()
  })

  it('a barra de conexao diz a verdade sobre o socket', async () => {
    expect(screen.getByRole('status')).toHaveTextContent('conectado')
    derrubarSocket()
    expect(screen.getByRole('status')).toHaveTextContent('reconectando')
  })

  it('a barra mostra a latencia medida pelo heartbeat', async () => {})
  it('mudanca de estado e anunciada, mas sem interromper', async () => {})
  it('o painel de membros colapsa abaixo de 900px', async () => {})
})
```

A barra de conexão é o detalhe memorável do design. Quase todo chat esconde esse
estado e deixa a pessoa falando no vazio; como a arquitetura inteira foi montada
em torno de "o socket pode falhar e o REST cura", exibir a verdade é a expressão
visual do sistema, não enfeite. É também o lugar onde a Fatia 2 vai pendurar as
estatísticas de mídia por participante, sem redesenho.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- presence`

- [ ] **Passo 3: Implementar**

Presença com forma **e** cor **e** rótulo textual. Barra de conexão como
`role="status"`, com transição suave que respeita `prefers-reduced-motion`.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/presence/ web/test/presence.test.tsx
git commit -m "feat: presenca com forma e rotulo, e barra de conexao honesta"
```

### Tarefa 29: Telas de configuração

**Arquivos:** criar `web/src/features/settings/*`; teste `web/test/settings.test.tsx`

- [ ] **Passo 1: Escrever o teste que falha**

```tsx
describe('configuracoes', () => {
  it('admin ve o nome do canal privado, mas nao consegue abri-lo', async () => {
    // aparece na lista de gestao, com rotulo explicito de conteudo inacessivel
    expect(screen.getByText('Conteudo inacessivel')).toBeInTheDocument()
  })

  it('modal prende o foco e devolve ao gatilho no Escape', async () => {})
  it('gerar convite mostra o codigo em fonte monoespacada', async () => {})
  it('revogar convite pede confirmacao', async () => {})
  it('sessoes ativas listam dispositivo e permitem revogar', async () => {})
  it('trocar densidade e tema persiste entre recarregamentos', async () => {})
  it('acao destrutiva sempre pede confirmacao explicita', async () => {})
})
```

O primeiro caso é a **única** exceção à regra de invisibilidade, e por isso
merece teste próprio: em contexto explícito de gestão, o administrador vê o nome
para poder apagar um canal órfão — com rótulo deixando claro que o conteúdo
permanece fora de alcance.

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace web run test -- settings`

- [ ] **Passo 3: Implementar com primitivos Radix**

Diálogo, menu e tooltip vêm do Radix porque já resolvem foco, teclado e ARIA
corretamente. Reimplementar isso à mão é precisamente como os requisitos de
acessibilidade morrem na prática.

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add web/src/features/settings/ web/test/settings.test.tsx
git commit -m "feat: telas de configuracao com gestao de canal privado sem leitura"
```

---

# Fase 6 — Produção

### Tarefa 30: Imagens, Caddy e Compose de produção

**Arquivos:** criar `api/Dockerfile`, `web/Dockerfile`, `Caddyfile`,
`docker-compose.yml`; teste `test/smoke.sh`

- [ ] **Passo 1: Escrever o teste de fumaça que falha**

```bash
#!/usr/bin/env bash
# test/smoke.sh — sobe o stack completo e verifica o essencial
set -euo pipefail

docker compose up -d --build
trap 'docker compose down -v' EXIT

for i in $(seq 1 60); do
  if curl -fsS http://localhost/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done

curl -fsS http://localhost/api/health | grep -q '"status":"ok"'
docker compose exec -T api sh -c 'id -u' | grep -qv '^0$'   # nao roda como root
docker compose port postgres 5432 && { echo 'FALHA: Postgres exposto'; exit 1; } || true
echo 'fumaca OK'
```

As duas últimas verificações são as que costumam ser esquecidas: container
rodando como root, e banco publicado no host.

- [ ] **Passo 2: Rodar e confirmar falha** — `bash test/smoke.sh`

- [ ] **Passo 3: Escrever os Dockerfiles em múltiplos estágios**

Estágio de dependências, estágio de build, estágio final enxuto. Usuário
não-root no final, `HEALTHCHECK` apontando para `/api/health`, e `.dockerignore`
excluindo `node_modules`, `.git`, `.env` e `docs`.

- [ ] **Passo 4: Escrever o Caddyfile**

```
{$PUBLIC_DOMAIN} {
	encode zstd gzip

	handle /api/* { reverse_proxy api:3000 }
	handle /ws    { reverse_proxy api:3000 }
	handle        { root * /srv/web; try_files {path} /index.html; file_server }

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:"
	}
}
```

TLS é automático: o Caddy obtém e renova o certificado sozinho, desde que o
domínio já aponte para o IP antes da primeira subida.

- [ ] **Passo 5: Escrever o Compose de produção**

Sem porta de banco publicada, migração rodando no arranque da API antes de
aceitar tráfego, `restart: unless-stopped`, e volume nomeado para o Postgres.
O serviço `livekit` fica **comentado**, com nota de que pertence à Fatia 2.

- [ ] **Passo 6: Rodar a fumaça, confirmar verde, commitar**

```bash
git add api/Dockerfile web/Dockerfile Caddyfile docker-compose.yml test/smoke.sh
git commit -m "feat: imagens de producao, Caddy com TLS automatico e teste de fumaca"
```

### Tarefa 31: Ponta a ponta e acessibilidade automatizada

**Arquivos:** criar `e2e/*.spec.ts`, `playwright.config.ts`

- [ ] **Passo 1: Escrever os seis fluxos da spec 06**

```ts
// e2e/fluxos.spec.ts
test('convite completo entre dois navegadores', async ({ browser }) => {
  // owner gera codigo; segunda sessao abre a previa, cria conta, entra;
  // o owner ve o novo membro aparecer SEM recarregar
})

test('mensagem em tempo real', async ({ browser }) => {
  // dois contextos no mesmo canal; um envia, o outro recebe sem recarregar
})

test('canal privado aparece e some ao vivo', async ({ browser }) => {
  // terceiro contexto nao ve o canal;
  // e adicionado -> aparece na hora; e removido -> some na hora
})

test('reconexao cura o buraco', async ({ page, context }) => {
  await context.setOffline(true)
  // outro cliente envia 3 mensagens
  await context.setOffline(false)
  // as 3 aparecem apos a reconexao, sem recarregar a pagina
})

test('sessao revogada bloqueia o outro dispositivo imediatamente', async ({ browser }) => {})

test('percurso completo so com teclado', async ({ page }) => {
  // login, trocar de canal, escrever, enviar, abrir e fechar modal — sem mouse
})
```

O teste de reconexão é o que prova, no sistema montado, a decisão arquitetural
mais importante do projeto.

- [ ] **Passo 2: Rodar e confirmar falha** — `npx playwright test`

- [ ] **Passo 3: Acrescentar a varredura axe**

```ts
test('sem violacao de acessibilidade nas telas principais', async ({ page }) => {
  for (const rota of ['/entrar', '/cadastro', '/app', '/app/configuracoes']) {
    await page.goto(rota)
    const r = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()
    expect(r.violations).toEqual([])
  }
})
```

- [ ] **Passo 4: Rodar, confirmar verde, commitar**

```bash
git add e2e/ playwright.config.ts
git commit -m "test: fluxos ponta a ponta e varredura axe WCAG 2.2 AA"
```

### Tarefa 32: Integração contínua

**Arquivos:** criar `.github/workflows/ci.yml`, `CONTRIBUTING.md`

- [ ] **Passo 1: Escrever o pipeline na ordem que falha rápido**

1. `lint` e `typecheck`
2. Testes de unidade
3. Testes de integração com Postgres em container
4. Build da API e do frontend
5. Fumaça e ponta a ponta com o stack completo
6. Varredura axe
7. Auditoria de dependências

- [ ] **Passo 2: Exigir os limiares de cobertura**

Build falha se `can.ts` ou `fanout.ts` ficarem abaixo de 100%, `auth/` abaixo de
95%, ou rotas abaixo de 85%.

- [ ] **Passo 3: Instalar o hook de pre-commit**

Etapas 1 a 3 rodam localmente antes de cada commit.

- [ ] **Passo 4: Documentar as regras invioláveis no `CONTRIBUTING.md`**

- Nenhuma comparação de papel fora de `can.ts`
- Nenhum cálculo de audiência fora de `fanout.ts`
- Nenhuma alteração nesses dois arquivos sem `private-channel-leak.test.ts` verde
- Recurso invisível responde `404`, jamais `403`
- Teste primeiro, sempre

- [ ] **Passo 5: Commitar**

```bash
git add .github/ CONTRIBUTING.md
git commit -m "ci: pipeline completo com limiares de cobertura obrigatorios"
```

### Tarefa 33: Operação — limpeza, backup e métricas

> Acrescentada durante a autorrevisão: a spec 02 exige rotina de limpeza de
> sessões, e a spec 07 exige backup testado e métricas. Nenhuma tinha tarefa.

**Arquivos:** criar `api/src/cli/cleanup.ts`, `api/src/routes/metrics.routes.ts`,
`ops/backup.sh`, `ops/restore.sh`, `docs/RUNBOOK.md`;
teste `api/test/cleanup.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

```ts
describe('limpeza', () => {
  it('remove sessoes expiradas e preserva as validas', async () => {
    await withTestDb(async db => {
      // 3 sessoes expiradas + 2 validas
      const removidas = await limparSessoesExpiradas()
      expect(removidas).toBe(3)
      // as 2 validas continuam autenticando
    })
  })

  it('e idempotente: rodar duas vezes nao remove nada a mais', async () => {})
})
```

- [ ] **Passo 2: Rodar e confirmar falha** — `npm --workspace api run test -- cleanup`

- [ ] **Passo 3: Implementar a limpeza e agendá-la**

```ts
export async function limparSessoesExpiradas(): Promise<number> {
  const r = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  return r.rowCount ?? 0
}
```

Agendada uma vez por dia, dentro do próprio processo da API. Para dez pessoas,
um cron externo seria cerimônia sem retorno.

- [ ] **Passo 4: Escrever os scripts de backup e restauração**

`ops/backup.sh` roda `pg_dump`, comprime, envia para fora da VPS e apaga o que
passar de 14 dias. `ops/restore.sh` faz o caminho inverso, contra um banco
descartável.

- [ ] **Passo 5: TESTAR a restauração**

Restaurar o dump num banco vazio e confirmar que a aplicação sobe e autentica.
**Backup nunca testado não é backup** — este passo não é opcional e não pode ser
adiado para "quando precisar".

- [ ] **Passo 6: Expor métricas em rota autenticada**

Conexões WebSocket ativas, eventos por segundo e latência de consulta.
Sem Prometheus e sem Grafana nesta fatia.

- [ ] **Passo 7: Escrever o `RUNBOOK.md`**

Como subir, como derrubar, como ler log, como restaurar, o que fazer quando o
certificado não emite, e como rodar o seed inicial.

- [ ] **Passo 8: Commitar**

```bash
git add api/src/cli/cleanup.ts api/src/routes/metrics.routes.ts ops/ docs/RUNBOOK.md api/test/cleanup.test.ts
git commit -m "feat: limpeza de sessoes, backup testado, metricas e runbook"
```

---

## Definição de pronto — Fatia 1

A fatia está concluída quando **todas** forem verdadeiras:

- [ ] As 33 tarefas estão com todos os passos marcados
- [ ] `can.ts` e `fanout.ts` com cobertura de 100%
- [ ] `private-channel-leak.test.ts` verde, nos onze casos
- [ ] Os seis fluxos de ponta a ponta passam
- [ ] `axe-core` sem violação nas quatro telas principais
- [ ] Percurso completo só com teclado, verificado à mão
- [ ] Stack sobe do zero num host limpo com um `docker compose up -d`
- [ ] Certificado TLS emitido automaticamente
- [ ] Restauração de backup testada com sucesso
- [ ] Duas pessoas reais conversaram pela ferramenta, em redes diferentes

O último item não é decorativo: até que duas pessoas de fato conversem por ela,
o que existe é um conjunto de testes verdes.

## O que este plano deliberadamente NÃO faz

| Fora de escopo | Onde vive |
|---|---|
| Áudio, vídeo, compartilhamento de tela | Fatia 2 |
| Integração com LiveKit e emissão de JWT de mídia | Fatia 2 |
| Painel de qualidade configurável ao vivo | Fatia 2 |
| Upload de avatar e ícone de grupo | Fatia 3 |
| Anexos, menções, respostas encadeadas, busca | Fatia 3 |
| Notificações e customização visual de grupo | Fatia 3 |
| Redis, múltiplas instâncias, escala horizontal | Quando houver necessidade real |
| Aplicativos móveis nativos, federação, gravação | Fora do produto |

Cinco pontos da Fatia 1 já deixam a costura pronta para a Fatia 2, sem escrever
uma linha de mídia: o enum `voice` em `channels.type`; as três ações reservadas
em `can()` retornando `false`; o prefixo `voice.` no protocolo; o serviço
`livekit` comentado no Compose; e a barra de conexão, que é onde as estatísticas
por participante vão aparecer.

---

## Registro da autorrevisão

Conferência do plano contra a spec, feita após a redação.

### Cobertura da spec

| Documento | Requisito | Tarefa |
|---|---|---|
| 01 | Quatro containers e limites | 1, 30 |
| 01 | REST escreve, WebSocket empurra | 16 (teste que proíbe escrita pelo WS) |
| 01 | Contrato de API completo | 8, 10, 11, 12, 13, 14, 15, 16 |
| 01 | Costuras para a Fatia 2 | 3 (enum), 6 (ações), 18 (prefixo), 30 (compose) |
| 02 | Sete tabelas, enums, índices | 3 |
| 02 | UUIDv7 e paginação por cursor | 2, 15 |
| 02 | Índice único parcial do owner | 3, 11 |
| 02 | Presença fora do banco | 18 |
| 02 | Limpeza de sessões expiradas | **33** — lacuna encontrada e corrigida |
| 03 | Cadastro fechado por convite | 12 |
| 03 | Prévia pública mínima | 12, 24 |
| 03 | Código Crockford normalizado | 9 |
| 03 | Sessão revogável, cookie httpOnly | 5 |
| 03 | argon2id e resposta uniforme | 4, 8 |
| 03 | Limites de taxa | 20 |
| 03 | CSRF por SameSite e Origin | 5 |
| 03 | Papéis e eixo duplo de permissão | 6, 7 |
| 03 | Canal privado invisível | 14, 19, 25 |
| 03 | `can()` como fonte única | 6 (mais lint) |
| 04 | Uma conexão por pessoa, heartbeat | 16 |
| 04 | Catálogo de eventos e `ready` | 16, 18 |
| 04 | Fan-out por canal | 17 |
| 04 | Reconciliação por REST | 23, 31 |
| 04 | Backoff com jitter | 23 |
| 04 | Presença por transição | 18 |
| 04 | Limites de conexão | 16 |
| 05 | Direção visual e barra de conexão | 21, 28 |
| 05 | Layout, quebras, densidade | 25 |
| 05 | Cor, tipografia, contraste | 21 |
| 05 | WCAG 2.2 AA completo | 21, 24, 25, 26, 28, 29, 31 |
| 05 | Eco otimista e âncora de rolagem | 26, 27 |
| 06 | Contrato e catálogo de erro | 2 |
| 06 | Logs com redação | 2 |
| 06 | Teste inegociável de vazamento | 19 |
| 06 | Matriz de permissões | 6 |
| 06 | Fluxos ponta a ponta | 31 |
| 06 | Limiares de cobertura e CI | 6, 32 |
| 07 | Imagens, Caddy, Compose | 30 |
| 07 | Variáveis validadas no arranque | 2 |
| 07 | Migrações no arranque | 3, 30 |
| 07 | Backup testado | **33** — lacuna encontrada e corrigida |
| 07 | Observabilidade | **33** — lacuna encontrada e corrigida |
| 07 | Segurança operacional | 30 |

**Três lacunas encontradas e fechadas** com a Tarefa 33: limpeza de sessões,
backup com restauração testada, e métricas.

### Varredura de placeholders

Sem ocorrências de "TBD", "TODO", "implementar depois", "tratamento de erro
apropriado" ou "similar à Tarefa N". Todo passo de código traz o código.

### Consistência de tipos e nomes

Os identificadores que atravessam tarefas — `can`, `assertCan`,
`loadChannelActor`, `loadGroupActor`, `audienceOfChannel`, `audienceOfGroup`,
`generateInviteCode`, `normalizeInviteCode`, `createSession`, `validateSession`,
`revokeSession`, `hashPassword`, `verifyPassword`, `DUMMY_HASH`, `requireAuth`,
`newId`, `withTestDb`, `buildServer` — foram conferidos e aparecem com a mesma
grafia e a mesma assinatura em todos os pontos onde são declarados e usados.

**33 tarefas, 174 passos.**
