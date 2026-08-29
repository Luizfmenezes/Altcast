import { and, eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import type { Database } from '../src/db/client.js'
import { channelMembers, channels, groupMembers, groups } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'

async function papeis(db: Database, groupId: string): Promise<Record<string, string>> {
  const linhas = await db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId))
  return Object.fromEntries(linhas.map(l => [l.userId, l.role]))
}

/** Membro comum acrescentado ao cenario padrao. */
async function comMembro(
  app: FastifyInstance, db: Database, groupId: string, email = 'ze@x.com',
): Promise<{ cookie: string; userId: string }> {
  const ze = await loginComo(app, db, email)
  await db.insert(groupMembers).values({ groupId, userId: ze.userId, role: 'member' })
  return ze
}

describe('membros', () => {
  it('lista os membros do grupo para quem pertence, e 404 para quem nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)

      const res = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/members`,
        headers: { cookie: cookieDono } })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(2)
      expect(res.json().map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'owner'])
      expect(res.json()[0]).toHaveProperty('displayName')

      const estranho = await loginComo(app, db, 'estranho@x.com')
      const negado = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/members`,
        headers: { cookie: estranho.cookie } })
      expect(negado.statusCode).toBe(404)
      await app.close()
    })
  })

  it('owner promove membro a admin', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)

      const res = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${ze.userId}`,
        headers: { cookie: cookieDono }, payload: { role: 'admin' } })
      expect(res.statusCode).toBe(200)
      expect((await papeis(db, groupId))[ze.userId]).toBe('admin')
      await app.close()
    })
  })

  it('admin nao consegue mudar papel', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieAdmin, groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)

      const res = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${ze.userId}`,
        headers: { cookie: cookieAdmin }, payload: { role: 'admin' } })
      expect(res.statusCode).toBe(404)
      expect((await papeis(db, groupId))[ze.userId]).toBe('member')
      await app.close()
    })
  })

  it('owner nao consegue sair sem transferir', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, ownerId, groupId } = await cenarioComAdmin(app, db)

      const res = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ownerId}`, headers: { cookie: cookieDono } })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('owner_cannot_leave')
      expect((await papeis(db, groupId))[ownerId]).toBe('owner')
      await app.close()
    })
  })

  it('ninguem remove o owner, nem o proprio owner rebaixa a si mesmo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, cookieAdmin, ownerId, groupId } = await cenarioComAdmin(app, db)

      const expulsar = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ownerId}`, headers: { cookie: cookieAdmin } })
      expect(expulsar.statusCode).toBe(409)

      const rebaixar = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${ownerId}`,
        headers: { cookie: cookieDono }, payload: { role: 'member' } })
      expect(rebaixar.statusCode).toBe(409)
      expect((await papeis(db, groupId))[ownerId]).toBe('owner')
      await app.close()
    })
  })

  it('transferir titularidade troca os dois papeis atomicamente', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, ownerId, adminId, groupId } = await cenarioComAdmin(app, db)

      const res = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${adminId}`,
        headers: { cookie: cookieDono }, payload: { role: 'owner' } })
      expect(res.statusCode).toBe(200)

      const p = await papeis(db, groupId)
      expect(p[adminId]).toBe('owner')
      expect(p[ownerId]).toBe('admin')
      expect(Object.values(p).filter(r => r === 'owner')).toHaveLength(1)

      const [g] = await db.select().from(groups).where(eq(groups.id, groupId))
      expect(g!.ownerId).toBe(adminId)

      // E o antigo dono, agora admin, perdeu o poder de mudar papel.
      const volta = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${ownerId}`,
        headers: { cookie: cookieDono }, payload: { role: 'owner' } })
      expect(volta.statusCode).toBe(404)
      await app.close()
    })
  })

  it('sair do grupo remove de todos os canais privados', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)

      const canal = newId()
      await db.insert(channels).values({
        id: canal, groupId, name: 'diretoria', visibility: 'private', position: 1,
      })
      await db.insert(channelMembers).values({ channelId: canal, userId: ze.userId })

      const res = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ze.userId}`, headers: { cookie: ze.cookie } })
      expect(res.statusCode).toBe(204)

      expect(await db.select().from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, ze.userId))))
        .toHaveLength(0)
      expect(await db.select().from(channelMembers)
        .where(eq(channelMembers.userId, ze.userId))).toHaveLength(0)
      await app.close()
    })
  })

  it('sair de um grupo nao afeta canal privado de outro grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)

      // Ze tambem pertence a um canal privado de um grupo alheio.
      const outro = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie: ze.cookie }, payload: { name: 'Outro' } })
      const canalOutro = newId()
      await db.insert(channels).values({
        id: canalOutro, groupId: outro.json().id, name: 'secreto',
        visibility: 'private', position: 1,
      })
      await db.insert(channelMembers).values({ channelId: canalOutro, userId: ze.userId })

      await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ze.userId}`, headers: { cookie: ze.cookie } })

      expect(await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, canalOutro))).toHaveLength(1)
      await app.close()
    })
  })

  it('admin remove member; member nao remove ninguem', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieAdmin, groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)
      const ana = await comMembro(app, db, groupId, 'ana@x.com')

      const negado = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ana.userId}`, headers: { cookie: ze.cookie } })
      expect(negado.statusCode).toBe(404)
      expect((await papeis(db, groupId))[ana.userId]).toBe('member')

      const ok = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}/members/${ze.userId}`, headers: { cookie: cookieAdmin } })
      expect(ok.statusCode).toBe(204)
      expect((await papeis(db, groupId))[ze.userId]).toBeUndefined()
      await app.close()
    })
  })

  it('recusa papel invalido e membro inexistente', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await comMembro(app, db, groupId)

      const papel = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${ze.userId}`,
        headers: { cookie: cookieDono }, payload: { role: 'imperador' } })
      expect(papel.statusCode).toBe(422)

      const fantasma = await app.inject({ method: 'PATCH',
        url: `/api/groups/${groupId}/members/${newId()}`,
        headers: { cookie: cookieDono }, payload: { role: 'admin' } })
      expect(fantasma.statusCode).toBe(404)
      await app.close()
    })
  })
})
