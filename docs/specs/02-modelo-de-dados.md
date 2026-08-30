# 02 — Modelo de dados

Banco: **PostgreSQL 16**. ORM: **Drizzle** (migrações versionadas em SQL puro,
tipagem derivada do schema, sem geração de cliente).

## 1. Diagrama

```
users ──┬─< sessions
        ├─< group_members >── groups ──< channels ──< messages ──< attachments
        ├─< invites                        │            │              │
        └─< channel_members >──────────────┘            └──────────────┘
```

## 2. Tabelas

### `users`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | UUIDv7 |
| `email` | `citext` UNIQUE NOT NULL | `citext` evita duplicata por maiúscula |
| `password_hash` | `text` NOT NULL | argon2id |
| `display_name` | `text` NOT NULL | 2–32 caracteres |
| `avatar_url` | `text` NULL | Fatia 3 |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

### `sessions`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | Valor do cookie |
| `user_id` | `uuid` FK → users ON DELETE CASCADE | |
| `expires_at` | `timestamptz` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL | |
| `last_seen_at` | `timestamptz` NOT NULL | Renovação deslizante |
| `user_agent` | `text` NULL | Para o usuário reconhecer o dispositivo |
| `ip` | `inet` NULL | |

Índice: `(user_id)`, `(expires_at)` para limpeza periódica.

### `groups`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` NOT NULL | 2–64 caracteres |
| `icon_url` | `text` NULL | Fatia 3 |
| `owner_id` | `uuid` FK → users ON DELETE RESTRICT | Transferível |
| `created_at` | `timestamptz` NOT NULL | |

`ON DELETE RESTRICT` é deliberado: apagar um usuário não pode apagar
silenciosamente os grupos dele. A titularidade precisa ser transferida antes.

### `group_members`
| Coluna | Tipo | Notas |
|---|---|---|
| `group_id` | `uuid` FK → groups ON DELETE CASCADE | |
| `user_id` | `uuid` FK → users ON DELETE CASCADE | |
| `role` | `role_enum` NOT NULL | `owner` / `admin` / `member` |
| `joined_at` | `timestamptz` NOT NULL | |

PK composta `(group_id, user_id)`. Índice adicional `(user_id)` — é a consulta
mais quente do sistema: "de quais grupos esta pessoa participa", executada em
todo `ready` de WebSocket.

**Invariante:** existe exatamente uma linha com `role = 'owner'` por grupo.
Garantida por índice único parcial:
`CREATE UNIQUE INDEX ON group_members (group_id) WHERE role = 'owner';`

### `invites`
| Coluna | Tipo | Notas |
|---|---|---|
| `code` | `text` PK | 8 caracteres, base32 Crockford |
| `group_id` | `uuid` FK → groups ON DELETE CASCADE | |
| `created_by` | `uuid` FK → users ON DELETE SET NULL | |
| `expires_at` | `timestamptz` NULL | NULL = não expira |
| `max_uses` | `integer` NULL | NULL = ilimitado |
| `uses` | `integer` NOT NULL DEFAULT 0 | |
| `revoked_at` | `timestamptz` NULL | |
| `created_at` | `timestamptz` NOT NULL | |

### `channels`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `group_id` | `uuid` FK → groups ON DELETE CASCADE | |
| `name` | `text` NOT NULL | 1–32, minúsculas, sem espaço |
| `type` | `channel_type_enum` NOT NULL | `text` / `voice` — `voice` só na F2 |
| `visibility` | `visibility_enum` NOT NULL DEFAULT `'public'` | `public` / `private` |
| `topic` | `text` NULL | |
| `position` | `integer` NOT NULL DEFAULT 0 | Ordem na barra lateral |
| `created_at` | `timestamptz` NOT NULL | |

Único: `(group_id, name)`. Índice: `(group_id, position)`.

### `channel_members`
Populada **apenas** para canais `private`.

| Coluna | Tipo | Notas |
|---|---|---|
| `channel_id` | `uuid` FK → channels ON DELETE CASCADE | |
| `user_id` | `uuid` FK → users ON DELETE CASCADE | |
| `added_by` | `uuid` FK → users ON DELETE SET NULL | |
| `added_at` | `timestamptz` NOT NULL | |

PK composta `(channel_id, user_id)`. Índice `(user_id)`.

**Invariante:** todo `user_id` aqui também existe em `group_members` do grupo do
canal. Verificada na aplicação e coberta por teste — não há FK composta capaz de
expressá-la diretamente.

### `messages`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | **UUIDv7 — ordenação cronológica vem daqui** |
| `channel_id` | `uuid` FK → channels ON DELETE CASCADE | |
| `author_id` | `uuid` FK → users ON DELETE SET NULL | Autor apagado ⇒ "usuário removido" |
| `content` | `text` NOT NULL | 1–4000 caracteres |
| `created_at` | `timestamptz` NOT NULL | |
| `edited_at` | `timestamptz` NULL | |
| `deleted_at` | `timestamptz` NULL | Soft delete |

Índice crítico: `(channel_id, id DESC)`.

### `attachments`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | UUIDv7 |
| `channel_id` | `uuid` NOT NULL → `channels` CASCADE | âncora de autorização |
| `message_id` | `uuid` NULL → `messages` CASCADE | nulo até a mensagem existir |
| `uploader_id` | `uuid` NULL → `users` SET NULL | |
| `object_key` | `text` NOT NULL | caminho no MinIO, derivado do `id` |
| `filename` | `text` NOT NULL | nome original — rótulo, nunca caminho |
| `content_type` | `text` NOT NULL | detectado no servidor por magic bytes |
| `byte_size` | `integer` NOT NULL | |
| `width`, `height` | `integer` NULL | preenchidos para imagem |
| `thumb_key` | `text` NULL | só imagem; vídeo usaria ffmpeg |
| `created_at` | `timestamptz` NOT NULL | |

`channel_id` parece derivável de `message_id` e não é. O anexo nasce **antes**
da mensagem — é o que permite barra de progresso e prévia antes de enviar — e
enquanto `message_id` for nulo o canal é a única âncora de autorização que
existe. Depois, ele ainda poupa um JOIN em toda leitura de arquivo.

O órfão que nunca vira mensagem é removido pela faxina de `cli/cleanup.ts`
depois de 24 horas, junto das sessões vencidas.

Desenho completo em `docs/superpowers/specs/2026-08-29-chat-rico-design.md`.

## 3. Por que UUIDv7

UUIDv7 embute o timestamp nos bits mais significativos, então ordenar por `id` é
ordenar por tempo. Três consequências concretas:

1. **Paginação sem `OFFSET`.** `WHERE channel_id = ? AND id < ? ORDER BY id DESC
   LIMIT 50` usa o índice diretamente e mantém desempenho constante mesmo com
   milhões de linhas. `OFFSET` degrada linearmente.
2. **Sem vazamento por enumeração.** IDs sequenciais revelam volume e permitem
   adivinhar o próximo recurso.
3. **Geração no cliente da aplicação**, sem ida ao banco — o que torna o eco
   otimista da interface trivial: o front já conhece o ID antes de o servidor
   responder.

Contra o UUIDv4: v4 é aleatório, fragmenta o índice B-tree e não ordena.

## 4. Migrações

Sequenciais, versionadas, apenas para frente. Nunca editar migração já aplicada.

| # | Conteúdo |
|---|---|
| `0001` | Extensões (`citext`), enums, `users`, `sessions` |
| `0002` | `groups`, `group_members` + índice único parcial de `owner` |
| `0003` | `invites` |
| `0004` | `channels`, `channel_members` |
| `0005` | `messages` + índice `(channel_id, id DESC)` |
| `0006` | Seed do primeiro usuário e grupo (idempotente, via CLI) |

Migração roda no start do container `altcast-api`, antes de aceitar tráfego.

## 5. Dados que NÃO ficam no banco

Deliberadamente em memória, porque são estado de conexão e não informação:

- **Presença** (quem está online) — mapa `userId → Set<conexão>`
- **Indicador de digitação** — TTL de 5 segundos
- **Registro de sockets vivos**

Consequência assumida: reiniciar a API zera a presença, que se reconstrói em
segundos conforme os clientes reconectam. É correto — presença é um fato sobre
conexões existentes agora, e depois do restart nenhuma existe.

Quando houver mais de uma instância da API, isto migra para Redis Pub/Sub. É o
**único** ponto do desenho que precisa mudar para escalar horizontalmente.

## 6. Retenção

Fatia 1 não apaga nada automaticamente. Sessões expiradas são limpas por rotina
diária. Política de retenção de mensagens fica para a Fatia 3, se desejada.
