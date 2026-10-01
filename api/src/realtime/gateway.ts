import { and, asc, desc, eq, isNotNull, or, getTableColumns, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { db } from '../db/client.js'
import {
  channelMembers, channels, groupMembers, groups, memberRoles, roles, users,
} from '../db/schema.js'
import { validateSession } from '../auth/session.js'
import { env } from '../env.js'
import { registry } from './registry.js'
import { presence, type StatusEscolhido } from './presence.js'
import { anunciarSeMudou, statusEfetivo } from './status.js'
import { naoLidasPorCanal } from '../atencao/naoLidas.js'
import { preferenciasDe } from '../routes/atencao.routes.js'
import { calls } from './calls.js'
import { cotaDeGrupos } from '../groups/limite.js'
import { leiturasDe } from '../routes/chatRico.routes.js'
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
  const [linhaDoEu] = await db.select({
    id: users.id, displayName: users.displayName, username: users.username,
    avatarUrl: users.avatarUrl, emailVerifiedAt: users.emailVerifiedAt,
    status: users.status, statusText: users.statusText, statusEmoji: users.statusEmoji,
    statusExpiresAt: users.statusExpiresAt,
    bio: users.bio, pronouns: users.pronouns,
    bannerColor: users.bannerColor, bannerUrl: users.bannerUrl,
  }).from(users).where(eq(users.id, userId)).limit(1)
  // O proprio status vai inteiro — escolhido, frase e prazo — porque e a
  // pessoa que o edita. Para os outros sai so o que `presence.visivel` deixa.
  const eu = linhaDoEu === undefined ? undefined : {
    ...linhaDoEu,
    status: statusEfetivo(linhaDoEu.status, linhaDoEu.statusExpiresAt),
  }

  const meusGrupos = await db.select({
    id: groups.id, name: groups.name, iconUrl: groups.iconUrl, role: groupMembers.role,
    kind: groups.kind, hiddenAt: groupMembers.hiddenAt,
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

  /**
   * O resto da fotografia sai em paralelo: sao sete perguntas independentes ao
   * banco, e em serie elas somavam sete idas e voltas antes do primeiro quadro
   * — o bastante para o `ready` atrasar segundos com o servidor ocupado.
   *
   * Os cargos dos meus grupos vem aqui, e nao por REST quando a tela de
   * membros abre, porque nome colorido aparece em toda a interface; e as
   * permissoes de cada cargo vao junto porque o cliente esconde botao que o
   * servidor recusaria — a autorizacao de verdade continua em `can`.
   */
  const semGrupo = ids.length === 0
  const [membros, meusCargos, vinculos, leituras, naoLidas, preferencias, cota] = await Promise.all([
    semGrupo ? [] : db.select({
      groupId: groupMembers.groupId,
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarUrl: users.avatarUrl,
      role: groupMembers.role,
      statusText: users.statusText,
      statusEmoji: users.statusEmoji,
    })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(inArray(groupMembers.groupId, ids)),
    semGrupo ? [] : db.select().from(roles)
      .where(inArray(roles.groupId, ids))
      .orderBy(desc(roles.position), asc(roles.name)),
    semGrupo ? [] : db.select({
      groupId: memberRoles.groupId, userId: memberRoles.userId, roleId: memberRoles.roleId,
    }).from(memberRoles).where(inArray(memberRoles.groupId, ids)),
    leiturasDe(userId),
    naoLidasPorCanal(userId, meusCanais.map(c => c.id)),
    preferenciasDe(userId),
    cotaDeGrupos(userId),
  ])

  return {
    user: eu ?? null,
    // Conversas fechadas vem junto, marcadas: a proxima mensagem as reabre, e
    // o cliente so consegue reabrir o que ja conhece.
    groups: meusGrupos.map(({ hiddenAt, ...g }) => ({ ...g, hidden: hiddenAt !== null })),
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
    members: membros.map(m => {
      const status = m.userId === userId && eu !== undefined
        // A propria pessoa se ve pelo que escolheu: o invisivel se ve
        // invisivel, e nao "offline", que seria mentira para quem esta aqui.
        ? eu.status
        : presence.visivel(m.userId)
      // A frase do status so aparece para quem esta visivel.
      const visivel = status !== 'offline'
      return {
        ...m,
        status,
        statusText: visivel ? m.statusText : null,
        statusEmoji: visivel ? m.statusEmoji : null,
      }
    }),
    /**
     * Ate onde esta pessoa leu cada canal.
     *
     * Vem como MARCO, e nao como contagem: o cliente deriva o numero de
     * nao-lidos comparando ids — que sao UUIDv7 e portanto ordenam por tempo.
     * Mandar a contagem obrigaria o servidor a recalcula-la a cada mensagem
     * nova de cada canal, para cada pessoa conectada.
     */
    reads: leituras,
    /**
     * Quantas mensagens cada canal tem depois do marco, e quantas me mencionam
     * (D3-C). Canal ausente e zero. Teto de 100 por canal.
     */
    unread: naoLidas,
    /** O que esta pessoa quer ouvir de cada grupo e canal. So dela. */
    notificationPrefs: preferencias,
    /**
     * Quantos grupos esta pessoa ja criou, e qual o teto dela.
     *
     * Vem no `ready`, e nao numa chamada REST a parte, porque o botao `(+)` da
     * barra lateral precisa nascer ja no estado certo. Buscar isso depois
     * faria o botao aparecer habilitado e desabilitar sozinho um instante
     * depois, que e o tipo de piscada que a fotografia inicial existe para
     * evitar.
     */
    groupQuota: cota,
    roles: meusCargos.map(r => ({
      id: r.id, groupId: r.groupId, name: r.name, color: r.color,
      position: r.position, permissions: r.permissions, isDefault: r.isDefault,
    })),
    memberRoles: vinculos,
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

    // Nulo ate o socket entrar no fan-out, la embaixo. A conexao pode cair
    // DURANTE o `montarReady`, e nesse caso nao ha registro nenhum a remover.
    let connectionId: string | null = null

    let jaSaiu = false
    const encerrar = (): void => {
      // `close` e `error` podem chegar os dois para a mesma conexao; sem esta
      // trava o contador de presenca cairia duas vezes.
      if (jaSaiu) return
      jaSaiu = true
      if (connectionId !== null) registry.remove(connectionId)
      const visivelAntes = presence.visivel(userId)
      if (presence.disconnect(userId)) {
        // Só quando cai a ULTIMA conexao: fechar uma aba de cinco nao pode
        // tirar ninguem da chamada que continua aberta na outra.
        //
        // E com atraso, nao na hora: a sala do LiveKit sobrevive a uma piscada
        // de rede, entao tirar a pessoa do mapa imediatamente a deixava
        // audivel e invisivel. Se ela voltar dentro da janela, a reconexao
        // cancela isto e ninguem ve nada acontecer.
        calls.agendarSaida(userId, env.VOICE_RECONNECT_GRACE_MS, channelId => {
          void sairDaChamada(userId, channelId)
        })
        // Quem estava invisivel ja aparecia offline: nao ha o que anunciar.
        if (visivelAntes !== 'offline') {
          void emit.toPeersOf(userId, { t: 'presence.update', d: { userId, status: 'offline' } })
        }
      }
    }

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
      // Os tratadores vao ao banco. Uma consulta que falha (banco fora,
      // deadlock) vira rejeicao, e rejeicao solta derruba o processo Node
      // inteiro — todas as conexoes, por causa de um quadro. Aqui ela vira log.
      const tratar = (): unknown => {
        if (tipo === 'pong') {
          return connectionId === null ? undefined : registry.markAlive(connectionId)
        }
        if (tipo === 'typing') return repassarTyping(userId, quadro)
        if (tipo === 'voice.join') return entrarNaChamada(userId, quadro)
        if (tipo === 'voice.leave') {
          const canal = canalDoQuadro(quadro)
          return canal === null ? undefined : sairDaChamada(userId, canal)
        }
        if (tipo === 'voice.state') return atualizarMidia(userId, quadro)
        if (tipo === 'presence.idle') {
          // O cliente avisa "fiquei dez minutos sem uso" e "voltei". So vale
          // um booleano: qualquer outra coisa e ignorada, como todo frame torto.
          const ocioso = (quadro as { d?: { idle?: unknown } })?.d?.idle
          if (typeof ocioso !== 'boolean') return
          return anunciarSeMudou(userId, presence.ocioso(userId, ocioso))
        }
        req.log.warn({ connectionId, tipo }, 'frame de tipo desconhecido descartado')
      }
      Promise.resolve(tratar()).catch((erro: unknown) => {
        req.log.error({ err: erro, connectionId, tipo }, 'falha ao tratar quadro do socket')
      })
    })

    /**
     * A fotografia e montada ANTES de o socket entrar no fan-out.
     *
     * Enquanto os `await` daqui correm, nenhum evento pode alcancar esta
     * conexao — e e isso que da ao cliente o direito de SUBSTITUIR o mapa de
     * chamadas em vez de funde-lo. Na ordem antiga o socket ja recebia eventos
     * durante a montagem, entao um `voice.participant_joined` podia chegar
     * antes do `ready` e ser apagado por ele; fundir consertaria esse caso e
     * criaria outro pior, em que quem saiu da sala enquanto a pessoa estava
     * fora nunca mais some da lista.
     */
    const fotografia = await montarReady(userId)
    // A conexao pode ter morrido durante a montagem. Sem isto, `registry.add`
    // guardaria um socket ja fechado e `presence` contaria alguem que saiu.
    if (jaSaiu) return

    // Voltou dentro da janela: a saida agendada morre aqui, e a lista de quem
    // esta na chamada nunca chega a piscar para ninguem.
    calls.cancelarSaida(userId)

    connectionId = registry.add(userId, socket)
    socket.on('pong', () => registry.markAlive(connectionId!))

    // A ordem importa: `add` pode derrubar a aba mais antiga do mesmo usuario,
    // e o `close` dela chega depois. Contar a nova primeiro evita um `offline`
    // espurio no meio de uma troca de aba.
    const escolhido = ((fotografia.user as { status?: StatusEscolhido } | null)?.status) ?? 'online'
    const ficouOnline = presence.connect(userId, escolhido)

    socket.send(JSON.stringify({ t: 'ready', d: fotografia }))

    // A chegada e anunciada com o status VISIVEL: o invisivel chega calado, e
    // quem escolheu "nao perturbe" chega assim, e nao como "online".
    if (ficouOnline && presence.visivel(userId) !== 'offline') {
      void emit.toPeersOf(userId, {
        t: 'presence.update', d: { userId, status: presence.visivel(userId) },
      })
    }
  })
}
