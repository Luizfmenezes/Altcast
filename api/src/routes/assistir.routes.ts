import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { db } from '../db/client.js'
import { channels, groupInvitations, groupMembers, groups, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { validateSession } from '../auth/session.js'
import { assertEmailVerificado } from '../auth/verificacao.js'
import { can } from '../permissions/can.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { calls } from '../realtime/calls.js'
import { emit } from '../realtime/emit.js'
import { emitirEntradaEmGrupo } from '../groups/eventos.js'
import { pedidos } from '../assistir/pedidos.js'
import type { PedidoParaAssistir } from '../assistir/pedidos.js'
import { env } from '../env.js'
import { uuidOu404 } from './groups.routes.js'

/**
 * "Assistir no Altcast" — o botao do cartao do Discord.
 *
 * O link do cartao e `/assistir/<quem transmite>/<canal>`, e vale enquanto essa
 * pessoa estiver naquela chamada. Quem clica e, quase sempre, um amigo do
 * Discord que NAO esta no grupo; ele pede, quem transmite aceita ou recusa, e
 * aceitar e convidar — com a mesma permissao que o convite comum exige.
 *
 * O link e publico por natureza (esta no perfil do Discord), e por isso nao
 * carrega segredo nenhum: o que impede alguem de entrar sem ser chamado e a
 * aprovacao, nunca o link.
 */

type Transmissao = {
  anfitriao: { id: string; displayName: string; avatarUrl: string | null }
  grupo: { id: string; name: string; iconUrl: string | null }
  canal: { id: string; name: string }
  tela: boolean
}

/**
 * A transmissao existe e aceita pedidos? Senao, `stream_unavailable`.
 *
 * Uma resposta so para todas as causas — acabou, canal privado, sem permissao
 * de convidar — de proposito: o link e publico, e dizer "este canal e privado"
 * a um estranho contaria que o canal existe.
 */
async function transmissaoAberta(anfitriaoId: string, channelId: string): Promise<Transmissao> {
  const naSala = calls.participantes(channelId).find(p => p.userId === anfitriaoId)
  if (naSala === undefined) throw new AppError('stream_unavailable')

  const [linha] = await db.select({
    canalId: channels.id, canalNome: channels.name, tipo: channels.type,
    visibilidade: channels.visibility,
    grupoId: groups.id, grupoNome: groups.name, grupoIcone: groups.iconUrl, kind: groups.kind,
  })
    .from(channels)
    .innerJoin(groups, eq(groups.id, channels.groupId))
    .where(eq(channels.id, channelId)).limit(1)

  // Canal privado nao: entrar no grupo nao daria acesso a ele, e aceitar o
  // pedido deixaria a pessoa num grupo sem ver a transmissao que foi buscar.
  if (!linha || linha.tipo !== 'voice' || linha.visibilidade !== 'public' || linha.kind === 'dm') {
    throw new AppError('stream_unavailable')
  }

  const ator = await loadGroupActor(anfitriaoId, linha.grupoId)
  if (!can(ator, 'group.invite', { kind: 'group' })) throw new AppError('stream_unavailable')

  const [anfitriao] = await db.select({
    displayName: users.displayName, avatarUrl: users.avatarUrl, verificadoEm: users.emailVerifiedAt,
  }).from(users).where(eq(users.id, anfitriaoId)).limit(1)
  // Mesma regra do convite comum: quem nao confirmou o e-mail nao convida.
  if (!anfitriao || anfitriao.verificadoEm === null) throw new AppError('stream_unavailable')

  return {
    anfitriao: { id: anfitriaoId, displayName: anfitriao.displayName, avatarUrl: anfitriao.avatarUrl },
    grupo: { id: linha.grupoId, name: linha.grupoNome, iconUrl: linha.grupoIcone },
    canal: { id: linha.canalId, name: linha.canalNome },
    tela: naSala.tela,
  }
}

async function ehMembro(userId: string, groupId: string): Promise<boolean> {
  const [m] = await db.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).limit(1)
  return m !== undefined
}

/** A sessao, se houver — a previa vale para quem ainda nao entrou. */
async function quemPergunta(req: FastifyRequest): Promise<string | null> {
  const bruto = req.cookies[env.SESSION_COOKIE_NAME]
  if (!bruto) return null
  const s = await validateSession(bruto)
  return s?.userId ?? null
}

/** O formato que quem transmite ve — no evento e na listagem. */
async function cartaoDoPedido(p: PedidoParaAssistir): Promise<unknown> {
  const [linha] = await db.select({
    displayName: users.displayName, avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.id, p.solicitanteId)).limit(1)
  const [lugar] = await db.select({ grupo: groups.name, canal: channels.name })
    .from(channels).innerJoin(groups, eq(groups.id, channels.groupId))
    .where(eq(channels.id, p.channelId)).limit(1)
  return {
    id: p.id,
    groupId: p.groupId,
    groupName: lugar?.grupo ?? '',
    channelId: p.channelId,
    channelName: lugar?.canal ?? '',
    solicitante: {
      id: p.solicitanteId,
      displayName: linha?.displayName ?? 'alguem',
      avatarUrl: linha?.avatarUrl ?? null,
    },
    criadoEm: new Date(p.criadoEm).toISOString(),
  }
}

function pedidoDoAnfitriao(id: string, anfitriaoId: string): PedidoParaAssistir {
  const p = pedidos.obter(id)
  // Pedido de outra pessoa responde igual a pedido inexistente.
  if (p === null || p.anfitriaoId !== anfitriaoId) throw new AppError('watch_request_not_found')
  return p
}

export async function assistirRoutes(app: FastifyInstance): Promise<void> {
  /**
   * O Client ID da Application do Discord, ou `null`.
   *
   * Vem do servidor, e nao embutido no app de desktop: assim o cartao liga e
   * desliga por variavel de ambiente, sem gerar e distribuir um instalador novo.
   * Nao e segredo — o Discord o mostra a quem quiser na pagina da Application.
   */
  app.get('/api/discord', async () => ({ clientId: env.DISCORD_CLIENT_ID ?? null }))

  /** A previa: quem transmite, em que grupo, e se quem pergunta ja e de la. */
  app.get('/api/assistir/:anfitriao/:canal', async req => {
    const p = req.params as { anfitriao: string; canal: string }
    const t = await transmissaoAberta(uuidOu404(p.anfitriao), uuidOu404(p.canal))
    const eu = await quemPergunta(req)
    const membro = eu === null ? null : await ehMembro(eu, t.grupo.id)

    return {
      anfitriao: { displayName: t.anfitriao.displayName, avatarUrl: t.anfitriao.avatarUrl },
      grupo: { name: t.grupo.name, iconUrl: t.grupo.iconUrl },
      tela: t.tela,
      membro,
      // Os ids so para quem ja e membro: e o que a tela precisa para abrir o
      // canal, e a um estranho eles nao servem para nada.
      ...(membro === true ? { groupId: t.grupo.id, channelId: t.canal.id } : {}),
    }
  })

  app.post('/api/assistir/:anfitriao/:canal/pedido', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const p = req.params as { anfitriao: string; canal: string }
    const anfitriaoId = uuidOu404(p.anfitriao)
    const solicitanteId = req.user!.id
    const t = await transmissaoAberta(anfitriaoId, uuidOu404(p.canal))

    if (solicitanteId === anfitriaoId || await ehMembro(solicitanteId, t.grupo.id)) {
      // Ja ser membro nao e erro para quem clicou: ele queria chegar la, e o
      // id no erro e o que deixa a tela leva-lo direto ao canal.
      throw new AppError('already_member', { groupId: t.grupo.id, channelId: t.canal.id })
    }

    const { pedido, novo } = pedidos.criar({
      anfitriaoId, solicitanteId, groupId: t.grupo.id, channelId: t.canal.id,
    })
    if (novo) emit.toUser(anfitriaoId, { t: 'watch_request.received', d: await cartaoDoPedido(pedido) })

    return reply.status(202).send({ id: pedido.id })
  })

  app.get('/api/pedidos-para-assistir', { preHandler: requireAuth }, async req =>
    Promise.all(pedidos.doAnfitriao(req.user!.id).map(cartaoDoPedido)))

  app.post('/api/pedidos-para-assistir/:id/aceitar', { preHandler: requireAuth }, async (req, reply) => {
    const anfitriaoId = req.user!.id
    const pedido = pedidoDoAnfitriao(uuidOu404((req.params as { id: string }).id), anfitriaoId)

    // A permissao de AGORA, e nao a de quando o pedido chegou: um cargo tirado
    // nesse meio tempo nao pode continuar convidando por um cartao antigo.
    assertCan(await loadGroupActor(anfitriaoId, pedido.groupId), 'group.invite', { kind: 'group' })
    await assertEmailVerificado(anfitriaoId)

    const entrou = await db.transaction(async tx => {
      const [ja] = await tx.select({ userId: groupMembers.userId }).from(groupMembers)
        .where(and(
          eq(groupMembers.groupId, pedido.groupId), eq(groupMembers.userId, pedido.solicitanteId),
        )).limit(1)
      if (ja) return false
      await tx.insert(groupMembers)
        .values({ groupId: pedido.groupId, userId: pedido.solicitanteId, role: 'member' })
      // O registro de quem trouxe quem: um convite dirigido, ja aceito.
      await tx.insert(groupInvitations).values({
        id: newId(), groupId: pedido.groupId, invitedBy: anfitriaoId,
        targetUserId: pedido.solicitanteId, role: 'member', acceptedAt: new Date(),
      })
      return true
    })
    pedidos.remover(pedido.id)

    if (entrou) {
      const [ele] = await db.select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users).where(eq(users.id, pedido.solicitanteId)).limit(1)
      // Mesmos dois eventos do aceite de convite: a lista de membros ganha a
      // linha, e o grupo (com os canais) aparece para quem entrou.
      await emit.toGroup(pedido.groupId, {
        t: 'member.joined',
        d: {
          groupId: pedido.groupId, userId: pedido.solicitanteId, role: 'member', status: 'online',
          displayName: ele?.displayName ?? 'usuario', avatarUrl: ele?.avatarUrl ?? null,
        },
      })
      await emitirEntradaEmGrupo('group.joined', pedido.solicitanteId, pedido.groupId, 'member')
    }

    // DEPOIS do `group.joined`: quando a tela de quem pediu for abrir o canal,
    // o grupo ja precisa estar na store dela.
    emit.toUser(pedido.solicitanteId, {
      t: 'watch_request.accepted',
      d: { id: pedido.id, groupId: pedido.groupId, channelId: pedido.channelId },
    })
    // As outras abas de quem transmite tiram o cartao.
    emit.toUser(anfitriaoId, { t: 'watch_request.closed', d: { id: pedido.id } })
    return reply.status(204).send()
  })

  app.post('/api/pedidos-para-assistir/:id/recusar', { preHandler: requireAuth }, async (req, reply) => {
    const anfitriaoId = req.user!.id
    const pedido = pedidoDoAnfitriao(uuidOu404((req.params as { id: string }).id), anfitriaoId)
    pedidos.remover(pedido.id)
    emit.toUser(pedido.solicitanteId, { t: 'watch_request.declined', d: { id: pedido.id } })
    emit.toUser(anfitriaoId, { t: 'watch_request.closed', d: { id: pedido.id } })
    return reply.status(204).send()
  })
}
