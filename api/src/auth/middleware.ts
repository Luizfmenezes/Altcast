import type { FastifyRequest } from 'fastify'
import { validateSession } from './session.js'
import { AppError } from '../shared/errors.js'
import { env } from '../env.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string }
    sessionId?: string
  }
}

/** preHandler: popula request.user ou lanca unauthenticated. */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  const raw = req.cookies[env.SESSION_COOKIE_NAME]
  if (!raw) throw new AppError('unauthenticated')
  const s = await validateSession(raw)
  if (!s) throw new AppError('unauthenticated')
  req.user = { id: s.userId }
  req.sessionId = raw
}
