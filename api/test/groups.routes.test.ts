import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { channels, groupMembers, groups } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'

describe('rotas de grupo', () => {
  it('criador vira owner e ganha canal geral', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'f@x.com')
      const res = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie }, payload: { name: 'Anticorp' } })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ name: 'Anticorp', role: 'owner' })

      // A listagem de canais e a Tarefa 13. A invariante verificada aqui e a
      // da transacao de criacao, e o banco a responde diretamente.
      const canais = await db.select().from(channels)
        .where(eq(channels.groupId, res.json().id))
      expect(canais.map(c => c.name)).toContain('geral')
      expect(canais[0]!.visibility).toBe('public')
      await app.close()
    })
  })

  it('nao-membro recebe 404, nunca 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const dono = await loginComo(app, db, 'dono@x.com')
      const g = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie: dono.cookie }, payload: { name: 'Privado' } })

      const estranho = await loginComo(app, db, 'estranho@x.com')
      const res = await app.inject({ method: 'GET',
        url: `/api/groups/${g.json().id}`, headers: { cookie: estranho.cookie } })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
      await app.close()
    })
  })

  it('admin nao consegue apagar o grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieAdmin, groupId } = await cenarioComAdmin(app, db)
      const res = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}`, headers: { cookie: cookieAdmin } })
      expect(res.statusCode).toBe(404)

      const restam = await db.select().from(groups).where(eq(groups.id, groupId))
      expect(restam).toHaveLength(1)
      await app.close()
    })
  })

  it('owner apaga o grupo e leva os vinculos junto', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const res = await app.inject({ method: 'DELETE',
        url: `/api/groups/${groupId}`, headers: { cookie: cookieDono } })
      expect(res.statusCode).toBe(204)

      expect(await db.select().from(groups).where(eq(groups.id, groupId))).toHaveLength(0)
      expect(await db.select().from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))).toHaveLength(0)
      await app.close()
    })
  })

  it('admin renomeia, member nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookieAdmin, groupId } = await cenarioComAdmin(app, db)
      const ok = await app.inject({ method: 'PATCH', url: `/api/groups/${groupId}`,
        headers: { cookie: cookieAdmin }, payload: { name: 'Time Novo' } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().name).toBe('Time Novo')

      const ze = await loginComo(app, db, 'ze@x.com')
      await db.insert(groupMembers).values({ groupId, userId: ze.userId, role: 'member' })
      const negado = await app.inject({ method: 'PATCH', url: `/api/groups/${groupId}`,
        headers: { cookie: ze.cookie }, payload: { name: 'Sequestrado' } })
      expect(negado.statusCode).toBe(404)
      await app.close()
    })
  })

  it('recusa nome fora de 2 a 64 caracteres', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'f@x.com')
      const res = await app.inject({ method: 'POST', url: '/api/groups',
        headers: { cookie }, payload: { name: 'A' } })
      expect(res.statusCode).toBe(422)
      expect(res.json().error.details.name).toBeTruthy()
      await app.close()
    })
  })

  it('id malformado devolve 404, nao 500', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'f@x.com')
      const res = await app.inject({ method: 'GET', url: '/api/groups/nao-e-uuid',
        headers: { cookie } })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('exige sessao', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const res = await app.inject({ method: 'POST', url: '/api/groups',
        payload: { name: 'Anonimo' } })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })
})
