# 01 — Arquitetura

## 1. Visão de containers

```
                        Internet
                            │
                            ▼
                   ┌─────────────────┐
                   │      caddy      │  :80 :443
                   │  TLS automático │  serve o front estático
                   └────────┬────────┘  roteia /api e /ws
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     ┌─────────────────┐         ┌─────────────────┐
     │  altcast-api    │         │  livekit        │  (Fatia 2)
     │  Node + Fastify │────────▶│  SFU + TURN     │
     │  REST + WS      │  assina │                 │
     └────────┬────────┘   JWT   └─────────────────┘
              │
              ▼
     ┌─────────────────┐
     │   postgres      │  única fonte de verdade durável
     └─────────────────┘
```

Quatro containers na Fatia 1 (`caddy`, `altcast-api`, `postgres`, e o build do
front servido pelo Caddy). O `livekit` entra na Fatia 2 sem alterar os demais.

## 2. Responsabilidade de cada componente

| Componente | Responsável por | Explicitamente NÃO faz |
|---|---|---|
| `caddy` | TLS, certificado, servir estáticos, proxy reverso | Autenticação, regra de negócio |
| `altcast-api` | Identidade, autorização, regras, persistência, fan-out | Processar mídia |
| `postgres` | Guardar contas, grupos, canais, mensagens | Estado de conexão, presença |
| `livekit` (F2) | Transporte de áudio/vídeo, TURN, simulcast | Saber quem é usuário |

O ponto crítico da separação: **LiveKit não conhece usuários.** Ele confia num
JWT assinado pela `altcast-api`. Toda a identidade e todas as regras de acesso
permanecem no seu banco, sob seu controle. Trocar LiveKit por mediasoup, ou por
um SFU gerenciado, afeta um módulo e nada mais.

## 3. A decisão estrutural: REST escreve, WebSocket empurra

**Toda mutação é uma requisição HTTP.** Enviar mensagem é
`POST /api/channels/:id/messages`. O servidor valida, autoriza, grava, responde
`201`, e só então empurra `message.created` pelo WebSocket para a audiência —
incluindo quem enviou.

**O WebSocket é unidirecional na prática.** Do cliente para o servidor trafegam
apenas `pong` e `typing`.

### Por que

Protocolos bidirecionais sobre WebSocket invariavelmente se tornam uma segunda
API sem status HTTP, sem cache, sem documentação, sem `curl`, sem teste de
integração simples. A regra de negócio se duplica entre os dois caminhos e
diverge com o tempo.

Mantendo o WS burro:

- Toda regra vive em um lugar só e é testável com requisição HTTP comum.
- Qualquer endpoint é depurável com `curl`.
- O canal de tempo real fica simples demais para quebrar.
- A camada de mídia (Fatia 2) pluga sem tocar no protocolo de aplicação.

### O custo, e por que é aceitável

Um round-trip a mais ao enviar mensagem. Imperceptível em rede normal, e a
interface já usa eco otimista — a mensagem aparece imediatamente, esmaecida,
antes da confirmação.

## 4. Estrutura de pastas

```
altcast/
├─ docker-compose.yml
├─ docker-compose.dev.yml
├─ Caddyfile
├─ .env.example
├─ docs/
│  ├─ specs/            ← estas especificações
│  └─ PLANO-IMPLEMENTACAO.md
├─ api/
│  ├─ Dockerfile
│  ├─ package.json
│  ├─ drizzle.config.ts
│  ├─ migrations/
│  └─ src/
│     ├─ index.ts              bootstrap do Fastify
│     ├─ env.ts                validação de variáveis de ambiente
│     ├─ db/
│     │  ├─ schema.ts          definição das tabelas
│     │  └─ client.ts          pool de conexão
│     ├─ auth/
│     │  ├─ password.ts        argon2id
│     │  ├─ session.ts         criar, validar, revogar
│     │  └─ middleware.ts      leitura do cookie
│     ├─ permissions/
│     │  └─ can.ts             ★ única fonte de autorização
│     ├─ routes/
│     │  ├─ auth.routes.ts
│     │  ├─ groups.routes.ts
│     │  ├─ invites.routes.ts
│     │  ├─ channels.routes.ts
│     │  └─ messages.routes.ts
│     ├─ realtime/
│     │  ├─ gateway.ts         upgrade, heartbeat, ciclo de vida
│     │  ├─ registry.ts        conexões vivas em memória
│     │  ├─ fanout.ts          ★ cálculo de audiência
│     │  └─ presence.ts
│     └─ shared/
│        ├─ errors.ts          contrato de erro
│        ├─ ids.ts             UUIDv7
│        └─ logger.ts
└─ web/
   ├─ Dockerfile
   ├─ vite.config.ts
   └─ src/
      ├─ main.tsx
      ├─ lib/
      │  ├─ api.ts             cliente REST tipado
      │  ├─ socket.ts          conexão, reconexão, backoff
      │  └─ store.ts
      ├─ features/
      │  ├─ auth/
      │  ├─ groups/
      │  ├─ channels/
      │  ├─ messages/
      │  └─ presence/
      └─ ui/                   componentes base + tokens
```

Os dois arquivos marcados com ★ concentram o risco do sistema: `can.ts` decide
quem pode o quê, `fanout.ts` decide quem recebe o quê. Ambos são pequenos,
isolados e cobertos por teste exaustivo.

## 5. Contrato de API (Fatia 1)

### Autenticação
| Método | Rota | Faz |
|---|---|---|
| `POST` | `/api/auth/register` | Cria conta **exigindo código de convite** |
| `POST` | `/api/auth/login` | Cria sessão, devolve cookie |
| `POST` | `/api/auth/logout` | Revoga a sessão atual |
| `GET` | `/api/auth/me` | Usuário atual + grupos |

### Grupos
| Método | Rota | Faz |
|---|---|---|
| `POST` | `/api/groups` | Cria grupo (criador vira `owner`) |
| `GET` | `/api/groups/:id` | Detalhe do grupo |
| `PATCH` | `/api/groups/:id` | Renomeia, troca ícone |
| `DELETE` | `/api/groups/:id` | Apaga (só `owner`) |
| `GET` | `/api/groups/:id/members` | Lista membros |
| `PATCH` | `/api/groups/:id/members/:userId` | Muda papel |
| `DELETE` | `/api/groups/:id/members/:userId` | Remove membro ou sai |

### Convites
| Método | Rota | Faz |
|---|---|---|
| `POST` | `/api/groups/:id/invites` | Gera código |
| `GET` | `/api/invites/:code` | **Público**: prévia mínima do grupo |
| `POST` | `/api/invites/:code/accept` | Consome, cria vínculo |
| `GET` | `/api/groups/:id/invites` | Lista convites ativos |
| `DELETE` | `/api/invites/:code` | Revoga |

### Canais
| Método | Rota | Faz |
|---|---|---|
| `POST` | `/api/groups/:id/channels` | Cria canal (`public` ou `private`) |
| `GET` | `/api/groups/:id/channels` | Lista **filtrada pela visibilidade** |
| `PATCH` | `/api/channels/:id` | Renomeia, tópico, posição |
| `DELETE` | `/api/channels/:id` | Apaga |
| `GET` | `/api/channels/:id/members` | Lista de acesso (canal privado) |
| `POST` | `/api/channels/:id/members` | Adiciona membro do grupo ao canal |
| `DELETE` | `/api/channels/:id/members/:userId` | Remove acesso |

### Mensagens
| Método | Rota | Faz |
|---|---|---|
| `GET` | `/api/channels/:id/messages?before=<id>&limit=50` | Histórico paginado |
| `POST` | `/api/channels/:id/messages` | Envia |
| `PATCH` | `/api/messages/:id` | Edita (só autor) |
| `DELETE` | `/api/messages/:id` | Soft delete (autor, `admin`, `owner`) |

### Tempo real
| Rota | Faz |
|---|---|
| `GET /ws` | Upgrade para WebSocket, autenticado pelo cookie |

## 6. Costuras preparadas para a Fatia 2

Pontos onde a Fatia 1 já deixa espaço, **sem escrever código de mídia**:

1. `channels.type` aceita `'voice'` desde a primeira migração.
2. `can()` já prevê as ações `channel.join_call` e `channel.publish`.
3. O protocolo de eventos reserva o prefixo `voice.*`.
4. `docker-compose.yml` documenta o serviço `livekit` comentado.
5. A barra de conexão da interface é o lugar previsto para estatísticas de mídia.
