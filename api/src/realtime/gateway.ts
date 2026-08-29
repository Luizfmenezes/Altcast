import { and, asc, eq, isNotNull, or, getTableColumns, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers, groups, users } from '../db/schema.js'
import { validateSession } from '../auth/session.js'
import { env } from '../env.js'
import { registry } from './registry.js'
import { serializeChannel } from '../routes/channels.routes.js'

/** Spec 04 secao 6: ping a cada 30s; sem pong em 60s a conexao e encerrada. */
const INTERVALO_HEARTBEAT_MS = 30_000

/** Spec 04 secao 10: o cliente so manda `pong` e `typing`. */
const TAMANHO_MAXIMO_FRAME = 4 * 1024

/**
 * O ready e a fotografia inicial do que o usuario pode ver — e a lista de
 * canais ja sai filtrada pela visibilidade. Um canal privado do qual ele nao
 * participa nao aparece aqui nem com flag, nem com nome, nem com ID: se
 * vazasse, "invisivel" seria so uma palavra na barra lateral.
 */
async function montarReady(userId: string): Promise<Record<string, unknown>> {
  const [eu] = await db.select({
    id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.id, userId)).limit(1)

  const meusGrupos = await db.select({
    id: groups.id, name: groups.name, iconUrl: groups.iconUrl, role: groupMembers.role,
  })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(groups.name))

  const ids = meusGrupos.map(g => g.id)

  // Mesmo LEFT JOIN da listagem REST: publico entra sempre, privado so com
  // linha em channel_members. Duplicar a regra em SQL diferente seria abrir
  // duas chances de errar em vez de uma.
  const meusCanais = ids.length === 0 ? [] : await db.select(getTableColumns(channels))
    .from(channels)
    .leftJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.userId, userId),
    ))
    .where(and(
      inArray(channels.groupId, ids),
      or(eq(channels.visibility, 'public'), isNotNull(channelMembers.userId)),
    ))
    .orderBy(asc(channels.position), asc(channels.id))

  const membros = ids.length === 0 ? [] : await db.select({
    groupId: groupMembers.groupId,
    userId: users.id,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
    role: groupMembers.role,
  })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(inArray(groupMembers.groupId, ids))

  return {
    user: eu ?? null,
    groups: meusGrupos,
    channels: meusCanais.map(serializeChannel),
    // `status` sai do registro em memoria, nunca do banco: presenca e um fato
    // sobre conexoes existentes agora.
    members: membros.map(m => ({
      ...m, status: registry.connectionsOf(m.userId) > 0 ? 'online' : 'offline',
    })),
    serverTime: new Date().toISOString(),
  }
}

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket, { options: { maxPayload: TAMANHO_MAXIMO_FRAME } })

  const relogio = setInterval(() => registry.heartbeat(), INTERVALO_HEARTBEAT_MS)
  // unref: um timer pendurado impediria o processo de encerrar sozinho.
  relogio.unref()
  app.addHook('onClose', async () => clearInterval(relogio))

  app.get('/ws', {
    websocket: true,
    // A autenticacao acontece ANTES do upgrade: sessao ausente, expirada ou
    // revogada vira 401 HTTP: nunca uma conexao que abre e fecha logo depois.
    preValidation: async (req, reply) => {
      const raw = req.cookies[env.SESSION_COOKIE_NAME]
      const sessao = raw ? await validateSession(raw) : null
      if (!sessao) return reply.status(401).send({
        error: { code: 'unauthenticated', message: 'Voce precisa entrar para continuar.',
          requestId: req.id, details: null },
      })
      req.user = { id: sessao.userId }
    },
  }, async (socket, req) => {
    const userId = req.user!.id
    const connectionId = registry.add(userId, socket)

    socket.on('pong', () => registry.markAlive(connectionId))
    socket.on('close', () => registry.remove(connectionId))
    socket.on('error', () => registry.remove(connectionId))

    socket.on('message', bruto => {
      // Nao existe caminho de escrita pelo WebSocket. Frame desconhecido — ou
      // nem sequer JSON — e descartado com aviso, e a conexao segue viva.
      // Spec 04 secao 2.
      let quadro: unknown
      try {
        quadro = JSON.parse(bruto.toString())
      } catch {
        req.log.warn({ connectionId }, 'frame ilegivel descartado')
        return
      }
      const tipo = (quadro as { t?: unknown })?.t
      if (tipo === 'pong') return registry.markAlive(connectionId)
      if (tipo === 'typing') return
      req.log.warn({ connectionId, tipo }, 'frame de tipo desconhecido descartado')
    })

    socket.send(JSON.stringify({ t: 'ready', d: await montarReady(userId) }))
  })
}
