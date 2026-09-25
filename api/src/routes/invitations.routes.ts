import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, type Database } from '../db/client.js'
import { groupInvitations, groupMembers, groups, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertEmailVerificado } from '../auth/verificacao.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { audienceOfUser } from '../realtime/fanout.js'
import { correioPadrao } from '../email/index.js'
import { emailDeConvite } from '../email/modelos.js'
import type { Correio } from '../email/tipos.js'
import { logger } from '../shared/logger.js'
import { env } from '../env.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * Convite dirigido a uma pessoa.
 *
 * Convive com `invites.routes.ts` sem se misturar. La o convite e um codigo
 * que circula: quem o receber entra, e o sistema nunca soube para quem ele foi
 * feito. Aqui o convite TEM destinatario, e e isso que o faz existir dentro do
 * aplicativo — quem ja tem conta ve o convite na propria interface, em tempo
 * real, sem link e sem depender de uma mensagem de e-mail chegar.
 *
 * A unificacao pelo endereco e o ponto central: quem convida digita um e-mail
 * e recebe sempre a mesma resposta. Por dentro, se existe conta com aquele
 * endereco o convite vai para a interface dela; se nao existe, fica preso ao
 * endereco e sai um e-mail. Quem convidou nunca descobre qual dos dois
 * aconteceu — e e isto que impede esta tela de virar um verificador de quem
 * tem conta aqui, pelo mesmo cuidado que `forgot-password` ja toma.
 */

type Transacao = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Duas semanas.
 *
 * Nao e seguranca — o convite so vale para o destinatario dele, e revoga-lo e
 * um clique. E higiene de tela: convite de tres meses atras na lista de
 * pendentes e ruido que ninguem sabe se ainda vale.
 */
const VALIDADE_MS = 14 * 86_400_000

const criarSchema = z.object({
  email: z.email().max(254).optional(),
  userId: z.uuid().optional(),
  role: z.enum(['admin', 'member']).default('member'),
}).refine(v => (v.email === undefined) !== (v.userId === undefined), {
  error: 'Informe um e-mail ou uma pessoa.', path: ['email'],
})

const buscaSchema = z.object({ q: z.string().trim().max(64).optional() })

/** Pendente e a ausencia dos tres carimbos: estado derivado, nao guardado. */
const aindaPendente = and(
  isNull(groupInvitations.acceptedAt),
  isNull(groupInvitations.declinedAt),
  isNull(groupInvitations.revokedAt),
)

function vencido(inv: { expiresAt: Date | null }): boolean {
  return inv.expiresAt !== null && inv.expiresAt.getTime() < Date.now()
}

/** `23505` e a violacao de unicidade do Postgres, e nada mais. */
function ehUnicidadeViolada(err: unknown): boolean {
  for (let atual = err, salto = 0; atual != null && salto < 4; salto++) {
    if ((atual as { code?: unknown }).code === '23505') return true
    atual = (atual as { cause?: unknown }).cause
  }
  return false
}

/**
 * Aceita, de uma vez, todo convite pendente enderecado a este endereco.
 *
 * Roda DENTRO da transacao que cria a conta — por senha ou pelo Google — pelo
 * mesmo motivo do `consumirConvite`: uma conta criada com os convites perdidos
 * no meio do caminho e um estado que nenhuma tela sabe consertar, e a pessoa
 * nem saberia que havia convite para perder.
 *
 * Convite que chegar DEPOIS do cadastro nao entra sozinho: ai existe uma
 * interface, e a decisao volta a ser de quem recebe.
 */
export async function resgatarConvites(
  tx: Transacao, userId: string, email: string,
): Promise<string[]> {
  const agora = new Date()
  const pendentes = await tx.select().from(groupInvitations)
    .where(and(eq(groupInvitations.targetEmail, email), aindaPendente))

  const entrou: string[] = []
  for (const inv of pendentes) {
    // Vencido nao entra, mas tambem nao fica pendente para sempre: o carimbo
    // de recusa e o que o tira da lista de quem convidou.
    if (vencido(inv)) {
      await tx.update(groupInvitations).set({ declinedAt: agora })
        .where(eq(groupInvitations.id, inv.id))
      continue
    }
    await tx.insert(groupMembers)
      .values({ groupId: inv.groupId, userId, role: inv.role })
      .onConflictDoNothing()
    await tx.update(groupInvitations).set({ acceptedAt: agora })
      .where(eq(groupInvitations.id, inv.id))
    entrou.push(inv.groupId)
  }
  return entrou
}

/** O rotulo que quem convidou ve: exatamente o endereco que ele digitou. */
async function enderecoDo(inv: {
  targetEmail: string | null; targetUserId: string | null
}): Promise<string> {
  if (inv.targetEmail !== null) return inv.targetEmail
  const [u] = await db.select({ email: users.email })
    .from(users).where(eq(users.id, inv.targetUserId!)).limit(1)
  return u?.email ?? 'conta removida'
}

export async function invitationsRoutes(app: FastifyInstance, opcoes?: {
  correio?: Correio
}): Promise<void> {
  const correio: Correio = opcoes?.correio ?? correioPadrao()

  /** Cria o convite. A resposta NAO diz qual dos dois caminhos foi tomado. */
  app.post('/api/groups/:id/invitations', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })
    // Depois da permissao, como em `invites.routes.ts`: quem nem administra o
    // grupo recebe 404 sem que a conta dele entre na conversa.
    await assertEmailVerificado(req.user!.id)

    const dados = parse(criarSchema, req.body ?? {})

    // Resolucao do destinatario. O e-mail digitado vira convite dirigido a uma
    // conta quando ela existe — e a partir daqui os dois caminhos sao um so.
    let alvoUserId: string | null = null
    let alvoEmail: string | null = null

    if (dados.userId !== undefined) {
      // Pelo seletor: so vale para quem ja compartilha um grupo com voce. Sem
      // este filtro a rota aceitaria qualquer UUID e viraria uma forma de
      // descobrir se um id existe.
      const conhecidos = await audienceOfUser(req.user!.id)
      if (!conhecidos.includes(dados.userId)) throw new AppError('not_found')
      alvoUserId = dados.userId
    } else {
      const [u] = await db.select({ id: users.id })
        .from(users).where(eq(users.email, dados.email!)).limit(1)
      if (u) alvoUserId = u.id
      else alvoEmail = dados.email!
    }

    if (alvoUserId === req.user!.id) throw new AppError('cannot_invite_self')

    if (alvoUserId !== null) {
      const [ja] = await db.select({ userId: groupMembers.userId }).from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvoUserId)))
        .limit(1)
      // Nao vaza nada: quem administra o grupo ja ve a lista de membros dele.
      if (ja) throw new AppError('already_member')
    }

    const id = newId()
    const expiresAt = new Date(Date.now() + VALIDADE_MS)
    try {
      await db.insert(groupInvitations).values({
        id, groupId, invitedBy: req.user!.id,
        targetUserId: alvoUserId, targetEmail: alvoEmail,
        role: dados.role, expiresAt,
      })
    } catch (err) {
      // 23505 e SOMENTE violacao de unicidade — aqui, o indice parcial que
      // garante um pendente por destinatario por grupo. Engolir todo erro
      // neste `catch` transformaria um banco fora do ar, ou uma coluna que
      // mudou, em "esta pessoa ja tem um convite pendente": a mensagem mais
      // convincente e mais errada que a tela poderia mostrar.
      //
      // O codigo vem em `cause` quando o drizzle embrulha o erro do
      // node-postgres, e na raiz quando nao embrulha. Olhar so um dos dois
      // faria a checagem passar hoje e falhar numa atualizacao da biblioteca.
      if (!ehUnicidadeViolada(err)) throw err
      throw new AppError('already_invited')
    }

    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    const [quemConvidou] = await db.select({
      displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(users).where(eq(users.id, req.user!.id)).limit(1)

    if (alvoUserId !== null) {
      // O caminho que dispensa e-mail inteiramente: a pessoa esta do outro lado
      // da mesma tela, e o convite acende la agora.
      emit.toUser(alvoUserId, {
        t: 'invitation.received',
        d: {
          id, groupId, groupName: g?.name ?? '', groupIconUrl: g?.iconUrl ?? null,
          role: dados.role, expiresAt,
          invitedBy: {
            displayName: quemConvidou?.displayName ?? 'alguem',
            avatarUrl: quemConvidou?.avatarUrl ?? null,
          },
        },
      })
    } else {
      // O destino e a tela de cadastro com o endereco ja preenchido, e nao uma
      // tela de convite: quem chega aqui, por definicao, ainda nao tem conta —
      // e o resgate acontece no cadastro, pelo endereco.
      await correio.enviar(emailDeConvite({
        para: alvoEmail!,
        grupo: g?.name ?? 'um grupo',
        convidadoPor: quemConvidou?.displayName ?? 'Alguem',
        url: `${env.PUBLIC_URL}/criar-conta?email=${encodeURIComponent(alvoEmail!)}`,
      })).catch((e: unknown) => {
        // Nao derruba: o convite EXISTE no banco e e resgatado no cadastro
        // pelo endereco, com ou sem a mensagem. Estourar aqui apagaria da tela
        // um convite que continua valendo.
        logger.error({ erro: e instanceof Error ? e.message : String(e), groupId },
          'convite criado, e-mail nao saiu')
      })
    }

    return reply.status(201).send({ id, role: dados.role, expiresAt })
  })

  /** Pendentes do grupo, para quem administra cancelar. */
  app.get('/api/groups/:id/invitations', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    const linhas = await db.select().from(groupInvitations)
      .where(and(eq(groupInvitations.groupId, groupId), aindaPendente))
      .orderBy(desc(groupInvitations.createdAt))

    /**
     * So o endereco, nunca o nome de exibicao.
     *
     * Devolver "Joao Silva" para um convite criado a partir de um e-mail
     * digitado contaria, pela porta dos fundos, que aquele endereco tem conta
     * aqui — exatamente o que a resposta unica da criacao esconde.
     */
    return Promise.all(linhas.filter(i => !vencido(i)).map(async i => ({
      id: i.id,
      email: await enderecoDo(i),
      role: i.role,
      invitedBy: i.invitedBy,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })))
  })

  app.delete('/api/groups/:id/invitations/:invitationId', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    const p = req.params as { id: string; invitationId: string }
    const groupId = uuidOu404(p.id)
    const invitationId = uuidOu404(p.invitationId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    const [inv] = await db.select().from(groupInvitations)
      .where(and(eq(groupInvitations.id, invitationId), eq(groupInvitations.groupId, groupId)))
      .limit(1)
    if (!inv) throw new AppError('invitation_not_found')

    // Marca, nao apaga: o mesmo padrao de `invites.revokedAt`. A linha guarda
    // quem convidou quem, e o indice parcial libera um convite novo.
    await db.update(groupInvitations).set({ revokedAt: new Date() })
      .where(eq(groupInvitations.id, invitationId))

    if (inv.targetUserId !== null) {
      emit.toUser(inv.targetUserId, { t: 'invitation.revoked', d: { id: invitationId } })
    }
    return reply.status(204).send()
  })

  /**
   * Pessoas que voce pode convidar sem digitar endereco.
   *
   * O universo e `audienceOfUser` — quem compartilha ao menos um grupo com
   * voce. Nao vaza nada: sao as mesmas pessoas que aparecem na lista de
   * membros que voce ja ve. Uma busca sobre a base inteira, por outro lado,
   * seria um diretorio de todo mundo que usa o sistema.
   */
  app.get('/api/groups/:id/invitable', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    const { q } = parse(buscaSchema, req.query ?? {})

    const conhecidos = await audienceOfUser(req.user!.id)
    if (conhecidos.length === 0) return []

    const membros = await db.select({ userId: groupMembers.userId })
      .from(groupMembers).where(eq(groupMembers.groupId, groupId))
    const jaDentro = new Set(membros.map(m => m.userId))

    const convidados = await db.select({ targetUserId: groupInvitations.targetUserId })
      .from(groupInvitations)
      .where(and(eq(groupInvitations.groupId, groupId), aindaPendente))
    for (const c of convidados) if (c.targetUserId !== null) jaDentro.add(c.targetUserId)

    const candidatos = conhecidos.filter(id => !jaDentro.has(id))
    if (candidatos.length === 0) return []

    const linhas = await db.select({
      id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(users).where(inArray(users.id, candidatos))

    const termo = (q ?? '').toLowerCase()
    return linhas
      .filter(u => termo === '' || u.displayName.toLowerCase().includes(termo))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
      .slice(0, 20)
  })

  /** Os meus convites pendentes. */
  app.get('/api/invitations', { preHandler: requireAuth }, async req => {
    const linhas = await db.select({
      id: groupInvitations.id,
      groupId: groupInvitations.groupId,
      groupName: groups.name,
      groupIconUrl: groups.iconUrl,
      role: groupInvitations.role,
      expiresAt: groupInvitations.expiresAt,
      createdAt: groupInvitations.createdAt,
      invitedByName: users.displayName,
      invitedByAvatar: users.avatarUrl,
    })
      .from(groupInvitations)
      .innerJoin(groups, eq(groups.id, groupInvitations.groupId))
      // `leftJoin` e nao `innerJoin`: `invited_by` e ON DELETE SET NULL, e quem
      // convidou pode ter saido do sistema sem levar junto o convite.
      .leftJoin(users, eq(users.id, groupInvitations.invitedBy))
      .where(and(eq(groupInvitations.targetUserId, req.user!.id), aindaPendente))
      .orderBy(desc(groupInvitations.createdAt))

    return linhas.filter(i => !vencido(i)).map(i => ({
      id: i.id,
      group: { id: i.groupId, name: i.groupName, iconUrl: i.groupIconUrl },
      role: i.role,
      invitedBy: {
        displayName: i.invitedByName ?? 'alguem',
        avatarUrl: i.invitedByAvatar ?? null,
      },
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    }))
  })

  app.post('/api/invitations/:id/accept', { preHandler: requireAuth }, async req => {
    const id = uuidOu404((req.params as { id: string }).id)
    const userId = req.user!.id

    const { groupId, role } = await db.transaction(async tx => {
      // `for('update')` pela mesma razao do convite por codigo: dois cliques
      // simultaneos no mesmo convite leriam ambos "pendente".
      const [inv] = await tx.select().from(groupInvitations)
        .where(eq(groupInvitations.id, id)).for('update').limit(1)

      // Convite de outra pessoa responde igual a convite inexistente: dizer
      // "existe, mas nao e seu" seria contar que ele existe.
      if (!inv || inv.targetUserId !== userId) throw new AppError('invitation_not_found')
      if (inv.acceptedAt || inv.declinedAt || inv.revokedAt || vencido(inv)) {
        throw new AppError('invitation_closed')
      }

      await tx.insert(groupMembers)
        .values({ groupId: inv.groupId, userId, role: inv.role })
        .onConflictDoNothing()
      await tx.update(groupInvitations).set({ acceptedAt: new Date() })
        .where(eq(groupInvitations.id, id))

      return { groupId: inv.groupId, role: inv.role }
    })

    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    const [eu] = await db.select({
      displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(users).where(eq(users.id, userId)).limit(1)

    // Depois do commit, e com o nome dentro do evento: o mesmo contrato que
    // `invites.routes.ts` ja cumpre, e o que faz a lista de membros desenhar a
    // linha nova sem uma segunda requisicao.
    // O papel do CONVITE, e nao 'member' fixo: convidar alguem como
    // administrador e depois a lista de membros mostra-lo como membro comum,
    // ate alguem recarregar, seria a interface mentindo sobre permissao.
    await emit.toGroup(groupId, {
      t: 'member.joined',
      d: {
        groupId, userId, role, status: 'online',
        displayName: eu?.displayName ?? 'usuario', avatarUrl: eu?.avatarUrl ?? null,
      },
    })

    return { group: { id: g!.id, name: g!.name, iconUrl: g!.iconUrl, role } }
  })

  app.post('/api/invitations/:id/decline', { preHandler: requireAuth }, async (req, reply) => {
    const id = uuidOu404((req.params as { id: string }).id)

    const [inv] = await db.select().from(groupInvitations)
      .where(and(
        eq(groupInvitations.id, id), eq(groupInvitations.targetUserId, req.user!.id),
      )).limit(1)
    if (!inv) throw new AppError('invitation_not_found')
    if (inv.acceptedAt || inv.declinedAt || inv.revokedAt) {
      throw new AppError('invitation_closed')
    }

    // Recusar libera o indice parcial: quem disse nao hoje pode ser convidado
    // de novo amanha, e essa segunda chance e deliberada.
    await db.update(groupInvitations).set({ declinedAt: new Date() })
      .where(eq(groupInvitations.id, id))

    return reply.status(204).send()
  })
}
