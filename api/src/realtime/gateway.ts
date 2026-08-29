import { and, asc, eq, isNotNull, or, getTableColumns, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers, groups, users } from '../db/schema.js'
import { validateSession } from '../auth/session.js'
import { env } from '../env.js'
import { registry } from './registry.js'
import { presence } from './presence.js'
import { calls } from './calls.js'
import { audienceOfChannel } from './fanout.js'
import { emit } from './emit.js'
import { loadChannelActor } from '../permissions/context.js'
import { can } from '../permissions/can.js'
import { serializeChannel } from '../routes/channels.routes.js'

/** Spec 04 secao 6: ping a cada 30s; sem pong em 60s a conexao e encerrada. */
const INTERVALO_HEARTBEAT_MS = 30_000

/** O cliente manda `pong`, `typing` e os tres quadros de chamada. */
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
    // Quem ja esta em chamada, apenas nos canais que ESTE usuario enxerga. A
    // lista sai de `meusCanais`, que ja veio filtrado pela visibilidade: uma
    // sala cheia num canal privado do qual ele nao participa nao existe aqui,
    // nem vazia, nem com contagem.
    calls: meusCanais
      .filter(c => c.type === 'voice')
      .map(c => ({ channelId: c.id, participants: calls.participantes(c.id) }))
      .filter(sala => sala.participants.length > 0),
    // `status` sai do registro em memoria, nunca do banco: presenca e um fato
    // sobre conexoes existentes agora.
    members: membros.map(m => ({
      ...m, status: presence.isOnline(m.userId) ? 'online' : 'offline',
    })),
    serverTime: new Date().toISOString(),
  }
}

/**
 * `typing` e o unico frame do cliente com efeito visivel, e mesmo assim nao
 * toca o banco: e efemero, expira em 5s no proprio cliente e nunca volta para
 * o autor. A audiencia sai do fanout como qualquer outro evento, entao um canal
 * privado continua mudo para quem nao participa.
 */
async function repassarTyping(userId: string, quadro: unknown): Promise<void> {
  const channelId = (quadro as { d?: { channelId?: unknown } })?.d?.channelId
  if (typeof channelId !== 'string') return

  const audiencia = (await audienceOfChannel(channelId)).filter(id => id !== userId)
  emit.toUsers(audiencia, { t: 'typing.start', d: { channelId, userId } })
}

/** O `channelId` que veio no quadro, ou null se o cliente mandou lixo. */
function canalDoQuadro(quadro: unknown): string | null {
  const id = (quadro as { d?: { channelId?: unknown } })?.d?.channelId
  return typeof id === 'string' ? id : null
}

/**
 * Entrar na chamada e uma decisao do SERVIDOR, tomada aqui, com as mesmas duas
 * perguntas do texto. O cliente que manda `voice.join` para um canal privado do
 * qual nao participa nao recebe erro nem confirmacao: o quadro e simplesmente
 * descartado, do mesmo jeito que o canal nao aparece na barra lateral dele.
 */
async function entrarNaChamada(userId: string, quadro: unknown): Promise<void> {
  const channelId = canalDoQuadro(quadro)
  if (channelId === null) return

  const carregado = await loadChannelActor(userId, channelId)
  if (!carregado || carregado.channel.type !== 'voice') return
  if (!can(carregado.actor, 'channel.join_call', {
    kind: 'channel', visibility: carregado.channel.visibility,
  })) return

  if (!calls.join(channelId, userId)) return
  await emit.toChannel(channelId, {
    t: 'voice.participant_joined',
    d: { channelId, userId, microfone: false, camera: false, tela: false },
  })
}

/** Sair nunca pede permissao: quem esta dentro sempre pode sair. */
async function sairDaChamada(userId: string, channelId: string): Promise<void> {
  if (!calls.leave(channelId, userId)) return
  await emit.toChannel(channelId, {
    t: 'voice.participant_left', d: { channelId, userId },
  })
}

/**
 * O que a pessoa esta transmitindo. Reavaliar `channel.publish` a cada quadro
 * — em vez de confiar no token de entrada — e o que faz alguem que perdeu o
 * acesso no meio da chamada parar de anunciar camera para a sala.
 */
async function atualizarMidia(userId: string, quadro: unknown): Promise<void> {
  const channelId = canalDoQuadro(quadro)
  if (channelId === null) return

  const d = (quadro as { d?: Record<string, unknown> }).d ?? {}
  const parcial = {
    ...(typeof d['microfone'] === 'boolean' ? { microfone: d['microfone'] } : {}),
    ...(typeof d['camera'] === 'boolean' ? { camera: d['camera'] } : {}),
    ...(typeof d['tela'] === 'boolean' ? { tela: d['tela'] } : {}),
  }
  if (Object.keys(parcial).length === 0) return

  const carregado = await loadChannelActor(userId, channelId)
  if (!carregado) return
  if (!can(carregado.actor, 'channel.publish', {
    kind: 'channel', visibility: carregado.channel.visibility,
  })) return

  const participante = calls.atualizar(channelId, userId, parcial)
  if (!participante) return
  await emit.toChannel(channelId, {
    t: 'voice.track_published', d: { channelId, ...participante },
  })
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

    // A ordem importa: `add` pode derrubar a aba mais antiga do mesmo usuario,
    // e o `close` dela chega depois. Contar a nova primeiro evita um `offline`
    // espurio no meio de uma troca de aba.
    const ficouOnline = presence.connect(userId)

    let jaSaiu = false
    const encerrar = (): void => {
      // `close` e `error` podem chegar os dois para a mesma conexao; sem esta
      // trava o contador de presenca cairia duas vezes.
      if (jaSaiu) return
      jaSaiu = true
      registry.remove(connectionId)
      if (presence.disconnect(userId)) {
        // Só quando cai a ULTIMA conexao: fechar uma aba de cinco nao pode
        // tirar ninguem da chamada que continua aberta na outra.
        for (const channelId of calls.canaisDe(userId)) {
          void sairDaChamada(userId, channelId)
        }
        void emit.toPeersOf(userId, { t: 'presence.update', d: { userId, status: 'offline' } })
      }
    }

    socket.on('pong', () => registry.markAlive(connectionId))
    socket.on('close', encerrar)
    socket.on('error', encerrar)

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
      if (tipo === 'typing') return repassarTyping(userId, quadro)
      if (tipo === 'voice.join') return entrarNaChamada(userId, quadro)
      if (tipo === 'voice.leave') {
        const canal = canalDoQuadro(quadro)
        return canal === null ? undefined : sairDaChamada(userId, canal)
      }
      if (tipo === 'voice.state') return atualizarMidia(userId, quadro)
      req.log.warn({ connectionId, tipo }, 'frame de tipo desconhecido descartado')
    })

    socket.send(JSON.stringify({ t: 'ready', d: await montarReady(userId) }))

    if (ficouOnline) {
      void emit.toPeersOf(userId, { t: 'presence.update', d: { userId, status: 'online' } })
    }
  })
}
