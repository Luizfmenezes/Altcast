import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { groupMembers, groups, users } from '../db/schema.js'
import { DUMMY_HASH, verifyPassword } from '../auth/password.js'
import { createSession, revokeSession } from '../auth/session.js'
import { requireAuth } from '../auth/middleware.js'
import { AppError } from '../shared/errors.js'
import { env } from '../env.js'

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(1024),
})

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86_400,
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('validation_failed')
    const { email, password } = parsed.data

    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)

    // A verificacao roda SEMPRE, inclusive quando o usuario nao existe. Sem
    // ela a resposta para e-mail inexistente voltaria em microssegundos e a
    // diferenca de tempo entregaria a lista de quem tem conta.
    const hash = u?.passwordHash ?? DUMMY_HASH
    const ok = await verifyPassword(hash, password)
    if (!u || !ok) throw new AppError('invalid_credentials')

    const s = await createSession(u.id, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieOptions())
    return { user: { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl } }
  })

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (req.sessionId !== undefined) await revokeSession(req.sessionId)
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async req => {
    const id = req.user!.id
    const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!u) throw new AppError('unauthenticated')

    const meus = await db
      .select({
        id: groups.id, name: groups.name, iconUrl: groups.iconUrl, role: groupMembers.role,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, id))

    return {
      user: { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl },
      groups: meus,
    }
  })
}
