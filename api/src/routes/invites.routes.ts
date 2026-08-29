import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, type Database } from '../db/client.js'
import { groupMembers, groups, invites } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { generateInviteCode, normalizeInviteCode } from '../invites/code.js'
import { contarMembros, parse, uuidOu404 } from './groups.routes.js'

type Invite = typeof invites.$inferSelect
type Motivo = 'not_found' | 'expired' | 'revoked' | 'max_uses_reached'
type Transacao = Parameters<Parameters<Database['transaction']>[0]>[0]

const gerarSchema = z.object({
  expiresInHours: z.int().min(1).max(24 * 365).nullable().optional(),
  maxUses: z.int().min(1).max(1000).nullable().optional(),
})

function motivoDaRecusa(inv: Invite | undefined): Motivo | null {
  if (!inv) return 'not_found'
  if (inv.revokedAt) return 'revoked'
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return 'expired'
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return 'max_uses_reached'
  return null
}

/**
 * Os dois formatos sao deliberados: no aceite, convite morto e erro do
 * envelope da spec 06 (410 com o codigo especifico); na previa publica e uma
 * resposta 200 que a pagina renderiza, porque distinguir os motivos ali nao
 * vaza nada — nenhum dado do grupo acompanha a recusa.
 */
const ERRO_POR_MOTIVO = {
  not_found: 'invite_not_found',
  expired: 'invite_expired',
  revoked: 'invite_revoked',
  max_uses_reached: 'invite_exhausted',
} as const

/**
 * Consome um convite dentro de uma transacao ja aberta e devolve o grupo.
 *
 * O `.for('update')` e o que impede dez aceites simultaneos de lerem `uses = 0`
 * e passarem todos: ele serializa as tentativas na linha do convite. Sem ele o
 * limite de usos e decorativo.
 *
 * Recebe a transacao em vez de abrir a propria porque o cadastro precisa criar
 * a conta e consumir o convite atomicamente — ou os dois, ou nenhum.
 */
export async function consumirConvite(
  tx: Transacao, codigo: string, userId: string,
): Promise<string> {
  const [inv] = await tx.select().from(invites)
    .where(eq(invites.code, codigo)).for('update').limit(1)

  const motivo = motivoDaRecusa(inv)
  if (motivo) throw new AppError(ERRO_POR_MOTIVO[motivo])

  const [ja] = await tx.select().from(groupMembers)
    .where(and(
      eq(groupMembers.groupId, inv!.groupId), eq(groupMembers.userId, userId),
    )).limit(1)
  // Antes do incremento, de proposito: recusa nao gasta uso.
  if (ja) throw new AppError('already_member')

  await tx.insert(groupMembers).values({ groupId: inv!.groupId, userId, role: 'member' })
  await tx.update(invites).set({ uses: inv!.uses + 1 }).where(eq(invites.code, codigo))

  return inv!.groupId
}

export async function invitesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/groups/:id/invites', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    const { expiresInHours, maxUses } = parse(gerarSchema, req.body ?? {})
    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 3_600_000)
      : null

    // Colisao no espaco de 32^8 e improvavel, nao impossivel. A chave primaria
    // recusa a duplicata e a nova tentativa resolve.
    for (let tentativa = 0; ; tentativa++) {
      const code = generateInviteCode()
      try {
        const [inv] = await db.insert(invites).values({
          code, groupId, createdBy: req.user!.id, expiresAt, maxUses: maxUses ?? null,
        }).returning()
        return reply.status(201).send({
          code: inv!.code, expiresAt: inv!.expiresAt,
          maxUses: inv!.maxUses, uses: inv!.uses, createdAt: inv!.createdAt,
        })
      } catch (err) {
        if (tentativa === 4) throw err
      }
    }
  })

  app.get('/api/groups/:id/invites', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    const linhas = await db.select().from(invites)
      .where(and(eq(invites.groupId, groupId), isNull(invites.revokedAt)))
      .orderBy(desc(invites.createdAt))

    // Convite vencido ou esgotado nao e "ativo": some da lista sem precisar de
    // faxina no banco.
    return linhas.filter(i => motivoDaRecusa(i) === null).map(i => ({
      code: i.code, expiresAt: i.expiresAt, maxUses: i.maxUses,
      uses: i.uses, createdBy: i.createdBy, createdAt: i.createdAt,
    }))
  })

  /**
   * A UNICA rota nao autenticada que devolve dado de grupo. O objeto e montado
   * campo a campo — nunca espalhando a linha do banco — porque um `...grupo`
   * aqui entregaria o id interno a qualquer um com um codigo vazado.
   */
  app.get('/api/invites/:code', async req => {
    const codigo = normalizeInviteCode((req.params as { code: string }).code)

    const [inv] = await db.select().from(invites).where(eq(invites.code, codigo)).limit(1)
    const motivo = motivoDaRecusa(inv)
    if (motivo) return { valid: false, reason: motivo }

    const [g] = await db.select().from(groups).where(eq(groups.id, inv!.groupId)).limit(1)
    if (!g) return { valid: false, reason: 'not_found' }

    return {
      valid: true,
      groupName: g.name,
      groupIconUrl: g.iconUrl,
      memberCount: await contarMembros(g.id),
    }
  })

  app.post('/api/invites/:code/accept', { preHandler: requireAuth }, async req => {
    const codigo = normalizeInviteCode((req.params as { code: string }).code)
    const userId = req.user!.id

    const groupId = await db.transaction(tx => consumirConvite(tx, codigo, userId))

    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    return { group: { id: g!.id, name: g!.name, iconUrl: g!.iconUrl, role: 'member' } }
  })

  app.delete('/api/invites/:code', { preHandler: requireAuth }, async (req, reply) => {
    const codigo = normalizeInviteCode((req.params as { code: string }).code)

    const [inv] = await db.select().from(invites).where(eq(invites.code, codigo)).limit(1)
    if (!inv) throw new AppError('not_found')

    const actor = await loadGroupActor(req.user!.id, inv.groupId)
    assertCan(actor, 'group.invite', { kind: 'group' })

    // Marca, nao apaga: quem ja entrou continua no grupo, e a linha preserva o
    // historico de quem convidou.
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.code, codigo))
    return reply.status(204).send()
  })
}
