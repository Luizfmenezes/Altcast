import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { groupMembers, groups, users } from '../db/schema.js'
import { DUMMY_HASH, assertPasswordAcceptable, hashPassword, verifyPassword } from '../auth/password.js'
import { createSession, revokeSession } from '../auth/session.js'
import { requireAuth } from '../auth/middleware.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { normalizeInviteCode } from '../invites/code.js'
import { consumirConvite } from './invites.routes.js'
import { emit } from '../realtime/emit.js'
import { env } from '../env.js'

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(1024),
})

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
  displayName: z.string().trim().min(2).max(64),
  // Sem convite valido nao existe cadastro. A porta de entrada do Altcast e a
  // lista de convidados, e e isso que dispensa verificacao de e-mail, fila de
  // aprovacao e defesa contra cadastro em massa (spec 03 secao 1).
  inviteCode: z.string().min(1).max(32),
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

/** O limite de rotas nao autenticadas e por origem de rede, nao por sessao. */
const porIp = (req: FastifyRequest): string => req.ip

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Spec 03 secao 6: 3 por hora por IP. Cadastro em massa e o vetor que este
  // limite fecha, e nenhum humano cria tres contas por hora de boa-fe.
  app.post('/api/auth/register', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour', keyGenerator: porIp } },
  }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError('validation_failed', z.flattenError(parsed.error).fieldErrors)
    }
    const { email, password, displayName } = parsed.data
    const inviteCode = normalizeInviteCode(parsed.data.inviteCode)

    assertPasswordAcceptable(password)

    const [existente] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, email)).limit(1)
    if (existente) throw new AppError('email_taken')

    // Fora da transacao: argon2id com 19 MiB leva centenas de milissegundos e
    // seguraria a linha travada do convite por todo esse tempo.
    const passwordHash = await hashPassword(password)

    const userId = newId()
    let groupId = ''
    await db.transaction(async tx => {
      await tx.insert(users).values({ id: userId, email, passwordHash, displayName })
      // Mesma transacao que a criacao da conta: um convite esgotado sem conta
      // criada, ou uma conta orfa sem grupo, seriam os dois estados que
      // nenhuma tela sabe consertar.
      groupId = await consumirConvite(tx, inviteCode, userId)
    })

    await emit.toGroup(groupId, { t: 'member.joined', d: { groupId, userId, role: 'member' } })

    const s = await createSession(userId, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieOptions())
    return reply.status(201).send({
      user: { id: userId, email, displayName, avatarUrl: null },
    })
  })

  app.post('/api/auth/login', {
    // 5 por minuto por IP freia a forca bruta distribuida por contas; o
    // segundo limite, 10 por hora por e-mail, freia a forca bruta concentrada
    // numa conta so, que trocar de IP contornaria. Sao eixos diferentes, e por
    // isso dois limitadores em vez de um.
    config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: porIp } },
    preHandler: app.rateLimit({
      max: 10, timeWindow: '1 hour',
      keyGenerator: req => {
        const email = (req.body as { email?: unknown })?.email
        return typeof email === 'string' ? `login:${email.toLowerCase()}` : req.ip
      },
    }),
  }, async (req, reply) => {
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
