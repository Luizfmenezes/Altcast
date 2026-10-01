import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { channels, groupMembers, groups } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { emitirEntradaEmGrupo } from '../groups/eventos.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * Conversas diretas (proposta 2026-09-10, caminho A).
 *
 * Uma conversa e um grupo `kind = 'dm'` com um canal de texto e um de voz.
 * Tudo o mais — mensagens, anexos, reacoes, leitura, chamada — usa as rotas de
 * canal que ja existem, com o `channelId` da conversa. Este arquivo so abre e
 * fecha; quem nega o resto e `context.ts`.
 */

const abrirSchema = z.object({ userId: z.uuid() })

/** A chave do par, independente de quem abriu. */
export function chaveDoPar(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * As duas pessoas dividem ao menos um GRUPO (conversa nao conta)?
 *
 * A mesma fronteira de quem ja ve o nome e a foto do outro. Conversa fica de
 * fora de proposito: sem isso, uma conversa aberta enquanto as duas dividiam
 * um grupo valeria para sempre como passe para abrir outras.
 */
async function dividemUmGrupo(eu: string, outro: string): Promise<boolean> {
  const meu = alias(groupMembers, 'meu')
  const [comum] = await db.select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(meu, and(eq(meu.groupId, groupMembers.groupId), eq(meu.userId, eu)))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, outro), eq(groups.kind, 'group')))
    .limit(1)
  return comum !== undefined
}

/** O canal de texto da conversa: e para la que a tela vai ao abrir. */
async function canalDeTexto(groupId: string): Promise<string | null> {
  const [c] = await db.select({ id: channels.id }).from(channels)
    .where(and(eq(channels.groupId, groupId), eq(channels.type, 'text')))
    .limit(1)
  return c?.id ?? null
}

export async function dmsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Abre — ou devolve a que ja existe. Idempotente: clicar duas vezes em
   * "Mensagem" no cartao de alguem nunca cria duas conversas, e quem decide
   * isso e o indice unico de `dm_key`, nao uma consulta antes da insercao.
   */
  app.post('/api/dms', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { userId: outro } = parse(abrirSchema, req.body)
    const eu = req.user!.id
    if (outro === eu) throw new AppError('not_found')
    if (!(await dividemUmGrupo(eu, outro))) throw new AppError('not_found')

    const chave = chaveDoPar(eu, outro)
    const groupId = newId()

    const criada = await db.transaction(async tx => {
      const [nova] = await tx.insert(groups)
        .values({ id: groupId, name: 'Conversa', ownerId: eu, kind: 'dm', dmKey: chave })
        .onConflictDoNothing()
        .returning({ id: groups.id })
      if (nova === undefined) return false
      // Os dois como `member`: numa conversa ninguem e dono de nada, e o
      // rotulo "Dono" na tela seria uma promessa que `context.ts` nao cumpre.
      await tx.insert(groupMembers).values([
        { groupId, userId: eu, role: 'member' },
        { groupId, userId: outro, role: 'member' },
      ])
      await tx.insert(channels).values([
        { id: newId(), groupId, name: 'conversa', type: 'text', position: 0 },
        { id: newId(), groupId, name: 'chamada', type: 'voice', position: 1 },
      ])
      return true
    })

    if (criada) {
      await emitirEntradaEmGrupo('group.created', eu, groupId, 'member')
      await emitirEntradaEmGrupo('group.joined', outro, groupId, 'member')
      return reply.status(201).send({ groupId, channelId: await canalDeTexto(groupId) })
    }

    // Ja existia. Se eu a tinha fechado, abrir de novo e reabri-la.
    const [existente] = await db.select({ id: groups.id }).from(groups)
      .where(eq(groups.dmKey, chave)).limit(1)
    if (!existente) throw new AppError('not_found')
    const reaberta = await db.update(groupMembers).set({ hiddenAt: null })
      .where(and(
        eq(groupMembers.groupId, existente.id),
        eq(groupMembers.userId, eu),
        isNotNull(groupMembers.hiddenAt),
      ))
      .returning({ hiddenAt: groupMembers.hiddenAt })
    if (reaberta.length > 0) emit.toUser(eu, { t: 'dm.shown', d: { groupId: existente.id } })
    return reply.status(200).send({ groupId: existente.id, channelId: await canalDeTexto(existente.id) })
  })

  /** Fecha da MINHA lista. Nao apaga nada, e o outro nao fica sabendo. */
  app.delete('/api/dms/:id', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const eu = req.user!.id
    const conversa = db.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.kind, 'dm')))
    const fechada = await db.update(groupMembers).set({ hiddenAt: new Date() })
      .where(and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, eu),
        // So conversa se fecha. Um grupo comum com `hidden_at` sumiria da
        // barra sem caminho de volta.
        inArray(groupMembers.groupId, conversa),
      ))
      .returning({ groupId: groupMembers.groupId })
    if (fechada.length === 0) throw new AppError('not_found')
    // As outras abas desta pessoa fecham junto.
    emit.toUser(eu, { t: 'dm.hidden', d: { groupId } })
    return reply.status(204).send()
  })
}

/**
 * Mensagem nova numa conversa devolve a conversa a lista de quem a fechou.
 *
 * Um UPDATE so, sem perguntar antes se o grupo e conversa: `hidden_at` so
 * existe em conversa, entao num grupo comum ele nunca acha linha. Quem a tinha
 * fechado recebe `dm.shown` — o cliente ja tem a conversa (o `ready` manda as
 * fechadas, marcadas) e so precisa voltar a mostra-la.
 */
export async function reabrirConversa(groupId: string, autor: string): Promise<void> {
  const reabertos = await db.update(groupMembers).set({ hiddenAt: null })
    .where(and(
      eq(groupMembers.groupId, groupId),
      ne(groupMembers.userId, autor),
      isNotNull(groupMembers.hiddenAt),
    ))
    .returning({ userId: groupMembers.userId })
  if (reabertos.length > 0) {
    emit.toUsers(reabertos.map(r => r.userId), { t: 'dm.shown', d: { groupId } })
  }
}
