import { createHash } from 'node:crypto'
import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions } from '../db/schema.js'
import { newId } from '../shared/ids.js'
import { env } from '../env.js'

type Meta = { userAgent: string | null; ip: string | null; ttlDays?: number }

export async function createSession(
  userId: string,
  meta: Meta,
): Promise<{ id: string; expiresAt: Date }> {
  const ttl = meta.ttlDays ?? env.SESSION_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttl * 86_400_000)
  const id = newId()
  await db.insert(sessions).values({
    id, userId, expiresAt, userAgent: meta.userAgent, ip: meta.ip,
  })
  return { id, expiresAt }
}

/** Devolve o dono da sessao e renova last_seen_at (renovacao deslizante). */
export async function validateSession(id: string): Promise<{ userId: string } | null> {
  const [row] = await db.select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1)
  if (!row) return null
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id))
  return row
}

/**
 * Identificador publico de uma sessao.
 *
 * O `id` da sessao E o token que viaja no cookie. Devolve-lo numa listagem
 * JSON entregaria a qualquer XSS a lista completa de credenciais vivas da
 * conta - inclusive as de outros aparelhos. O hash identifica a linha sem
 * servir para autenticar nada.
 */
export function sessionHandle(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 32)
}

export type SessaoVisivel = {
  handle: string
  userAgent: string | null
  ip: string | null
  createdAt: Date
  lastSeenAt: Date
  current: boolean
}

/** Sessoes vivas do usuario, da mais recente para a mais antiga. */
export async function listSessions(
  userId: string, atual: string,
): Promise<SessaoVisivel[]> {
  const linhas = await db.select().from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt))

  return linhas.map(s => ({
    handle: sessionHandle(s.id),
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: s.id === atual,
  }))
}

/**
 * Revoga pelo identificador publico, sempre restrito ao dono.
 *
 * O filtro por `userId` nao e redundante com o hash: sem ele, quem descobrisse
 * o handle de outra pessoa - numa captura de tela, num log - derrubaria a
 * sessao dela.
 */
export async function revokeSessionByHandle(
  userId: string, handle: string,
): Promise<boolean> {
  const linhas = await db.select({ id: sessions.id }).from(sessions)
    .where(eq(sessions.userId, userId))
  const alvo = linhas.find(s => sessionHandle(s.id) === handle)
  if (!alvo) return false
  await db.delete(sessions).where(eq(sessions.id, alvo.id))
  return true
}

/** Revogar e apagar a linha, e o efeito e imediato. E o que um JWT nao
 *  permitiria: com token assinado, remover alguem nao encerraria o acesso
 *  antes do vencimento. */
export async function revokeSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}
