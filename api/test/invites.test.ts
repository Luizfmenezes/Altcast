import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { groupMembers, invites } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'

/** Gera um convite pela rota e devolve o codigo. */
async function gerarConvite(
  app: FastifyInstance, cookie: string, groupId: string,
  corpo: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/groups/${groupId}/invites`,
    headers: { cookie }, payload: corpo })
  expect(res.statusCode).toBe(201)
  return res.json().code as string
}

const CONTA = { password: 'senha-longa-boa', displayName: 'Novo' }

describe('convites', () => {
  it('owner e admin geram; member nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, cookieAdmin, groupId } = await cenarioComAdmin(app, db)

      expect(await gerarConvite(app, cookieDono, groupId)).toHaveLength(8)
      expect(await gerarConvite(app, cookieAdmin, groupId)).toHaveLength(8)

      const ze = await loginComo(app, db, 'ze@x.com')
      await db.insert(groupMembers).values({ groupId, userId: ze.userId, role: 'member' })
      const negado = await app.inject({ method: 'POST', url: `/api/groups/${groupId}/invites`,
        headers: { cookie: ze.cookie }, payload: {} })
      expect(negado.statusCode).toBe(404)
      await app.close()
    })
  })

  it('previa publica revela apenas nome, icone e contagem', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)

      const res = await app.inject({ method: 'GET', url: `/api/invites/${code}` })
      expect(res.statusCode).toBe(200)
      expect(Object.keys(res.json()).sort())
        .toEqual(['groupIconUrl', 'groupName', 'memberCount', 'valid'])
      expect(res.json()).toMatchObject({ valid: true, groupName: 'Time', memberCount: 2 })
      // nunca: groupId, members, channels, messages
      expect(JSON.stringify(res.json())).not.toContain(groupId)
      await app.close()
    })
  })

  it('previa de codigo inexistente devolve 200 com motivo e sem dado de grupo', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const res = await app.inject({ method: 'GET', url: '/api/invites/ZZZZZZZZ' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ valid: false, reason: 'not_found' })
      await app.close()
    })
  })

  it('cadastro sem codigo e recusado', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const res = await app.inject({ method: 'POST', url: '/api/auth/register',
        payload: { email: 'novo@x.com', ...CONTA } })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  it('cadastro com codigo cria conta e vinculo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)

      const res = await app.inject({ method: 'POST', url: '/api/auth/register',
        payload: { email: 'novo@x.com', inviteCode: code, ...CONTA } })
      expect(res.statusCode).toBe(201)
      expect(res.headers['set-cookie']).toBeTruthy()

      const membros = await db.select().from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))
      expect(membros).toHaveLength(3)
      expect(membros.find(m => m.userId === res.json().user.id)?.role).toBe('member')

      const [inv] = await db.select().from(invites).where(eq(invites.code, code))
      expect(inv!.uses).toBe(1)
      await app.close()
    })
  })

  it('cadastro com codigo invalido nao cria conta nenhuma', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const res = await app.inject({ method: 'POST', url: '/api/auth/register',
        payload: { email: 'novo@x.com', inviteCode: 'ZZZZZZZZ', ...CONTA } })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('invite_not_found')
      expect(await db.select().from(groupMembers)).toHaveLength(0)
      await app.close()
    })
  })

  it('codigo expirado devolve invite_expired', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)
      await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invites.code, code))

      const ze = await loginComo(app, db, 'ze@x.com')
      const res = await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      expect(res.statusCode).toBe(410)
      expect(res.json().error.code).toBe('invite_expired')

      const previa = await app.inject({ method: 'GET', url: `/api/invites/${code}` })
      expect(previa.json()).toEqual({ valid: false, reason: 'expired' })
      await app.close()
    })
  })

  it('codigo revogado devolve invite_revoked', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)

      const rev = await app.inject({ method: 'DELETE', url: `/api/invites/${code}`,
        headers: { cookie: cookieDono } })
      expect(rev.statusCode).toBe(204)

      const ze = await loginComo(app, db, 'ze@x.com')
      const res = await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      expect(res.statusCode).toBe(410)
      expect(res.json().error.code).toBe('invite_revoked')

      const previa = await app.inject({ method: 'GET', url: `/api/invites/${code}` })
      expect(previa.json()).toEqual({ valid: false, reason: 'revoked' })
      await app.close()
    })
  })

  it('codigo esgotado devolve invite_exhausted', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId, { maxUses: 1 })

      const ze = await loginComo(app, db, 'ze@x.com')
      const primeiro = await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      expect(primeiro.statusCode).toBe(200)

      const ana = await loginComo(app, db, 'ana@x.com')
      const segundo = await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ana.cookie } })
      expect(segundo.statusCode).toBe(410)
      expect(segundo.json().error.code).toBe('invite_exhausted')

      const previa = await app.inject({ method: 'GET', url: `/api/invites/${code}` })
      expect(previa.json()).toEqual({ valid: false, reason: 'max_uses_reached' })
      await app.close()
    })
  })

  it('aceitar duas vezes devolve already_member', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)

      const ze = await loginComo(app, db, 'ze@x.com')
      await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      const deNovo = await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      expect(deNovo.statusCode).toBe(409)
      expect(deNovo.json().error.code).toBe('already_member')

      // A recusa nao pode ter gasto um uso.
      const [inv] = await db.select().from(invites).where(eq(invites.code, code))
      expect(inv!.uses).toBe(1)
      await app.close()
    })
  })

  it('revogar nao expulsa quem ja entrou', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)

      const ze = await loginComo(app, db, 'ze@x.com')
      await app.inject({ method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: ze.cookie } })
      await app.inject({ method: 'DELETE', url: `/api/invites/${code}`,
        headers: { cookie: cookieDono } })

      const membros = await db.select().from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))
      expect(membros.map(m => m.userId)).toContain(ze.userId)
      await app.close()
    })
  })

  it('aceita codigo digitado com I, L e O trocados', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId)
      // Quem recebeu o codigo por telefone digita as ambiguidades de volta.
      const digitado = code.replace(/1/g, 'I').replace(/0/g, 'O').toLowerCase()

      const previa = await app.inject({ method: 'GET', url: `/api/invites/${digitado}` })
      expect(previa.json().valid).toBe(true)

      const ze = await loginComo(app, db, 'ze@x.com')
      const res = await app.inject({ method: 'POST', url: `/api/invites/${digitado}/accept`,
        headers: { cookie: ze.cookie } })
      expect(res.statusCode).toBe(200)
      await app.close()
    })
  })

  it('lista os convites ativos do grupo para quem administra', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const vivo = await gerarConvite(app, cookieDono, groupId)
      const morto = await gerarConvite(app, cookieDono, groupId)
      await app.inject({ method: 'DELETE', url: `/api/invites/${morto}`,
        headers: { cookie: cookieDono } })

      const res = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/invites`,
        headers: { cookie: cookieDono } })
      expect(res.statusCode).toBe(200)
      expect(res.json().map((i: { code: string }) => i.code)).toEqual([vivo])

      const ze = await loginComo(app, db, 'ze@x.com')
      await db.insert(groupMembers).values({ groupId, userId: ze.userId, role: 'member' })
      const negado = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/invites`,
        headers: { cookie: ze.cookie } })
      expect(negado.statusCode).toBe(404)
      await app.close()
    })
  })

  it('uso concorrente nao ultrapassa max_uses', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const code = await gerarConvite(app, cookieDono, groupId, { maxUses: 3 })

      const cookies: string[] = []
      for (let i = 0; i < 10; i++) {
        cookies.push((await loginComo(app, db, `p${i}@x.com`)).cookie)
      }

      const respostas = await Promise.all(cookies.map(cookie =>
        app.inject({ method: 'POST', url: `/api/invites/${code}/accept`, headers: { cookie } })))

      expect(respostas.filter(r => r.statusCode === 200)).toHaveLength(3)
      expect(respostas.filter(r => r.statusCode === 410)).toHaveLength(7)

      const [inv] = await db.select().from(invites).where(eq(invites.code, code))
      expect(inv!.uses).toBe(3)
      const membros = await db.select().from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))
      expect(membros).toHaveLength(5)  // owner + admin + 3
      await app.close()
    })
  })
})
