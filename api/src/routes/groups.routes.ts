import { and, count, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers, groups, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { audienceOfGroup } from '../realtime/fanout.js'

const nome = z.string().trim().min(2).max(64)
const iconUrl = z.url().max(2048).nullable().optional()

const criarSchema = z.object({ name: nome, iconUrl })
const papelSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) })
const atualizarSchema = z.object({ name: nome.optional(), iconUrl })
  .refine(v => v.name !== undefined || v.iconUrl !== undefined, {
    error: 'Informe ao menos um campo.', path: ['name'],
  })

/**
 * zod devolve o mapa campo -> mensagens que a spec 06 exige em `details`.
 * A mensagem do envelope continua sendo a do catalogo; `details` e o que a
 * interface usa para destacar o campo errado.
 */
function parse<T>(schema: z.ZodType<T>, entrada: unknown): T {
  const r = schema.safeParse(entrada)
  if (!r.success) throw new AppError('validation_failed', z.flattenError(r.error).fieldErrors)
  return r.data
}

/**
 * Um `:id` que nao e UUID nunca chega ao banco: a coluna e uuid e o Postgres
 * responderia com erro de sintaxe, virando 500. Recurso inexistente e 404.
 */
function uuidOu404(valor: string): string {
  if (!z.uuid().safeParse(valor).success) throw new AppError('not_found')
  return valor
}

async function contarMembros(groupId: string): Promise<number> {
  const [linha] = await db.select({ n: count() }).from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return linha?.n ?? 0
}

async function carregarGrupo(groupId: string): Promise<typeof groups.$inferSelect> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  if (!g) throw new AppError('not_found')
  return g
}

/** O alvo precisa pertencer ao grupo; um userId qualquer nao vira membro novo. */
async function membroOu404(
  groupId: string, userId: string,
): Promise<typeof groupMembers.$inferSelect> {
  const [m] = await db.select().from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).limit(1)
  if (!m) throw new AppError('not_found')
  return m
}

export async function groupsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/groups', { preHandler: requireAuth }, async (req, reply) => {
    const { name, iconUrl: icone } = parse(criarSchema, req.body)
    const userId = req.user!.id
    const groupId = newId()

    // Quatro insercoes ou nenhuma. Um grupo sem dono, ou sem canal, seria um
    // estado que nenhuma rota posterior sabe consertar.
    await db.transaction(async tx => {
      await tx.insert(groups).values({ id: groupId, name, iconUrl: icone ?? null, ownerId: userId })
      await tx.insert(groupMembers).values({ groupId, userId, role: 'owner' })
      await tx.insert(channels).values({ id: newId(), groupId, name: 'geral', position: 0 })
    })

    return reply.status(201).send({
      id: groupId, name, iconUrl: icone ?? null, role: 'owner', memberCount: 1,
    })
  })

  app.get('/api/groups/:id', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    if (!g) throw new AppError('not_found')

    return {
      id: g.id, name: g.name, iconUrl: g.iconUrl,
      createdAt: g.createdAt, role: actor.role, memberCount: await contarMembros(groupId),
    }
  })

  app.patch('/api/groups/:id', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.update', { kind: 'group' })

    const campos = parse(atualizarSchema, req.body)
    const [g] = await db.update(groups)
      .set({
        ...(campos.name !== undefined ? { name: campos.name } : {}),
        ...(campos.iconUrl !== undefined ? { iconUrl: campos.iconUrl } : {}),
      })
      .where(eq(groups.id, groupId)).returning()
    if (!g) throw new AppError('not_found')

    return {
      id: g.id, name: g.name, iconUrl: g.iconUrl,
      createdAt: g.createdAt, role: actor.role, memberCount: await contarMembros(groupId),
    }
  })

  app.delete('/api/groups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.delete', { kind: 'group' })

    // Membros, canais, convites e mensagens caem por ON DELETE CASCADE.
    await db.delete(groups).where(eq(groups.id, groupId))
    return reply.status(204).send()
  })

  app.get('/api/groups/:id/members', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    return db.select({
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId))
  })

  app.patch('/api/groups/:id/members/:userId', { preHandler: requireAuth }, async req => {
    const p = req.params as { id: string; userId: string }
    const groupId = uuidOu404(p.id)
    const alvo = uuidOu404(p.userId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.change_role', { kind: 'group' })

    // Desestruturado de proposito: a regra de lint proibe comparar `.role`
    // fora de can.ts, e com razao. Aqui o valor nao e o papel de ninguem — e o
    // papel PEDIDO no corpo, e a autorizacao ja foi decidida acima.
    const { role: novoPapel } = parse(papelSchema, req.body)

    const g = await carregarGrupo(groupId)
    const atual = await membroOu404(groupId, alvo)

    if (alvo === g.ownerId && novoPapel !== 'owner') {
      // Grupo sem dono nao existe. O indice unico parcial impede DOIS owners;
      // esta guarda impede ZERO.
      throw new AppError('owner_cannot_leave')
    }

    if (novoPapel === 'owner') {
      // Rebaixar antes de promover. Na ordem inversa, group_one_owner_idx
      // recusaria a transacao — e esse e exatamente o papel dele: transformar
      // um erro de logica em erro de banco.
      await db.transaction(async tx => {
        await tx.update(groupMembers).set({ role: 'admin' })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'owner')))
        await tx.update(groupMembers).set({ role: 'owner' })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))
        await tx.update(groups).set({ ownerId: alvo }).where(eq(groups.id, groupId))
      })
    } else {
      await db.update(groupMembers).set({ role: novoPapel })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))
    }

    const dados = { groupId, userId: alvo, role: novoPapel, joinedAt: atual.joinedAt }
    await emit.toGroup(groupId, { t: 'member.updated', d: dados })
    return dados
  })

  app.delete('/api/groups/:id/members/:userId', { preHandler: requireAuth }, async (req, reply) => {
    const p = req.params as { id: string; userId: string }
    const groupId = uuidOu404(p.id)
    const alvo = uuidOu404(p.userId)
    const eu = req.user!.id

    const actor = await loadGroupActor(eu, groupId)
    // Sair e direito de qualquer membro; expulsar exige group.kick. Um member
    // que nao pertence ao grupo cai no group.view e leva 404 igual.
    assertCan(actor, alvo === eu ? 'group.view' : 'group.kick', { kind: 'group' })

    const g = await carregarGrupo(groupId)
    await membroOu404(groupId, alvo)

    // Vale para sair e para ser expulso: o dono nao e removivel. Transferir a
    // titularidade e o unico caminho.
    if (alvo === g.ownerId) throw new AppError('owner_cannot_leave')

    // Antes da remocao, para que quem saiu tambem receba o aviso e limpe o
    // grupo da propria barra lateral sem precisar recarregar.
    const audiencia = await audienceOfGroup(groupId)

    await db.transaction(async tx => {
      await tx.delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))

      // Explicito, e nao por cascata: channel_members referencia channels e
      // users, jamais group_members. Sem este DELETE, quem sai do grupo
      // continuaria em channel_members dos canais privados dele — e voltaria a
      // ler tudo se fosse readmitido. Spec 03 secao 9.
      const doGrupo = tx.select({ id: channels.id }).from(channels)
        .where(eq(channels.groupId, groupId))
      await tx.delete(channelMembers).where(and(
        eq(channelMembers.userId, alvo),
        inArray(channelMembers.channelId, doGrupo),
      ))
    })

    emit.toUsers(audiencia, { t: 'member.left', d: { groupId, userId: alvo } })
    return reply.status(204).send()
  })
}

export { contarMembros, parse, uuidOu404 }
