import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers } from '../db/schema.js'
import { AppError } from '../shared/errors.js'
import { can, type Action, type Actor, type Resource } from './can.js'

export type ChannelRow = typeof channels.$inferSelect

/** Busca o papel do usuario no grupo. role null significa que ele nao pertence. */
export async function loadGroupActor(userId: string, groupId: string): Promise<Actor> {
  const [linha] = await db.select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)
  return { userId, role: linha?.role ?? null, inChannel: false }
}

/**
 * Carrega o canal, deriva o papel no grupo e — somente se o canal for privado —
 * consulta channel_members para preencher inChannel.
 *
 * Devolve null quando o canal nao existe, para que a rota responda 404 sem
 * ramificacao extra.
 */
export async function loadChannelActor(
  userId: string,
  channelId: string,
): Promise<{ actor: Actor; channel: ChannelRow } | null> {
  const [canal] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1)
  if (!canal) return null

  const actor = await loadGroupActor(userId, canal.groupId)

  if (canal.visibility === 'private') {
    const [dentro] = await db.select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1)
    actor.inChannel = dentro !== undefined
  }

  return { actor, channel: canal }
}

/**
 * Lanca not_found — nunca forbidden — quando a acao e negada.
 *
 * Nao e cosmetico: um 403 num canal privado confirmaria que o canal existe, e a
 * spec 03 secao 9 estabelece que privado e invisivel, nao trancado.
 */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw new AppError('not_found')
}
