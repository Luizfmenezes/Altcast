import { count, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { channels, groupMembers, groups } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'

const nome = z.string().trim().min(2).max(64)
const iconUrl = z.url().max(2048).nullable().optional()

const criarSchema = z.object({ name: nome, iconUrl })
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
}

export { contarMembros, parse, uuidOu404 }
