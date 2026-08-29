import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { createSession, validateSession, revokeSession, revokeAllSessions } from '../src/auth/session.js'
import { users } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { requireAuth } from '../src/auth/middleware.js'
import { buildServer } from '../src/index.js'

describe('sessoes', () => {
  it('cria, valida e revoga', async () => {
    await withTestDb(async db => {
      const uid = newId()
      await db.insert(users).values({ id: uid, email: 'f@x.com', passwordHash: 'h', displayName: 'F' })

      const s = await createSession(uid, { userAgent: 'vitest', ip: '127.0.0.1' })
      expect(await validateSession(s.id)).toMatchObject({ userId: uid })

      await revokeSession(s.id)
      expect(await validateSession(s.id)).toBeNull()
    })
  })

  it('recusa sessao expirada', async () => {
    await withTestDb(async db => {
      const uid = newId()
      await db.insert(users).values({ id: uid, email: 'g@x.com', passwordHash: 'h', displayName: 'G' })
      const s = await createSession(uid, { userAgent: 'vitest', ip: null, ttlDays: -1 })
      expect(await validateSession(s.id)).toBeNull()
    })
  })

  it('revogacao global encerra todas as sessoes do usuario', async () => {
    await withTestDb(async db => {
      const uid = newId()
      await db.insert(users).values({ id: uid, email: 'h@x.com', passwordHash: 'h', displayName: 'H' })
      const a = await createSession(uid, { userAgent: 'a', ip: null })
      const b = await createSession(uid, { userAgent: 'b', ip: null })
      await revokeAllSessions(uid)
      expect(await validateSession(a.id)).toBeNull()
      expect(await validateSession(b.id)).toBeNull()
    })
  })

  // O plano usava /api/auth/me aqui, mas essa rota so existe na Tarefa 8 —
  // sem ela o teste veria 404 e nao 401. A guarda e exercitada diretamente.
  it('rota protegida devolve 401 sem cookie', async () => {
    const app = await buildServer()
    app.get('/protegida', { preHandler: requireAuth }, async () => ({ ok: true }))
    const res = await app.inject({ method: 'GET', url: '/protegida' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
    await app.close()
  })

  it('recusa cookie de sessao inexistente', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      app.get('/protegida', { preHandler: requireAuth }, async () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET', url: '/protegida',
        cookies: { altcast_session: newId() },
      })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })
})
