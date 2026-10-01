import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'
import { groupMembers, groups } from '../src/db/schema.js'
import { cotaDeGrupos } from '../src/groups/limite.js'
import { newId } from '../src/shared/ids.js'

/**
 * Conversas diretas: um grupo `kind = 'dm'` que as rotas de canal servem como
 * qualquer outro, e que `context.ts` tranca para tudo que nao e conversar.
 */

type Pessoa = { cookie: string; userId: string }

async function cenario(app: FastifyInstance, db: Database): Promise<{
  ana: Pessoa; beto: Pessoa; caio: Pessoa; grupo: string
}> {
  const ana = await loginComo(app, db, 'ana@x.com')
  const beto = await loginComo(app, db, 'beto@x.com')
  const caio = await loginComo(app, db, 'caio@x.com')
  const r = await app.inject({
    method: 'POST', url: '/api/groups', headers: { cookie: ana.cookie }, payload: { name: 'Time' },
  })
  const grupo = r.json().id as string
  await db.insert(groupMembers).values({ groupId: grupo, userId: beto.userId, role: 'member' })
  return { ana, beto, caio, grupo }
}

function abrir(app: FastifyInstance, eu: Pessoa, outro: string) {
  return app.inject({
    method: 'POST', url: '/api/dms', headers: { cookie: eu.cookie }, payload: { userId: outro },
  })
}

function enviar(app: FastifyInstance, eu: Pessoa, canal: string, content: string) {
  return app.inject({
    method: 'POST', url: `/api/channels/${canal}/messages`, headers: { cookie: eu.cookie },
    payload: { id: newId(), content },
  })
}

describe('conversas diretas', () => {
  it('abre uma conversa entre quem divide um grupo, e as mensagens correm nela', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, beto } = await cenario(app, db)

      const r = await abrir(app, ana, beto.userId)
      expect(r.statusCode).toBe(201)
      const { groupId, channelId } = r.json() as { groupId: string; channelId: string }

      const [g] = await db.select().from(groups).where(eq(groups.id, groupId))
      expect(g).toMatchObject({ kind: 'dm' })

      expect((await enviar(app, ana, channelId, 'oi')).statusCode).toBe(201)
      expect((await enviar(app, beto, channelId, 'oi, ana')).statusCode).toBe(201)

      const historico = await app.inject({
        method: 'GET', url: `/api/channels/${channelId}/messages`, headers: { cookie: beto.cookie },
      })
      expect(historico.statusCode).toBe(200)
      await app.close()
    })
  })

  it('e idempotente nos dois sentidos: o par tem uma conversa so', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, beto } = await cenario(app, db)

      const [a, b] = await Promise.all([abrir(app, ana, beto.userId), abrir(app, beto, ana.userId)])
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201])
      expect(a.json().groupId).toBe(b.json().groupId)
      expect(await db.$count(groups, eq(groups.kind, 'dm'))).toBe(1)
      await app.close()
    })
  })

  it('recusa quem nao divide grupo nenhum, e a si mesmo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, caio } = await cenario(app, db)

      expect((await abrir(app, ana, caio.userId)).statusCode).toBe(404)
      expect((await abrir(app, ana, ana.userId)).statusCode).toBe(404)
      expect((await abrir(app, ana, newId())).statusCode).toBe(404)
      await app.close()
    })
  })

  it('nem quem abriu renomeia, convida, cria canal ou apaga a conversa', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, beto } = await cenario(app, db)
      const { groupId } = (await abrir(app, ana, beto.userId)).json() as { groupId: string }
      const headers = { cookie: ana.cookie }

      const tentativas = await Promise.all([
        app.inject({ method: 'PATCH', url: `/api/groups/${groupId}`, headers, payload: { name: 'x' } }),
        app.inject({ method: 'DELETE', url: `/api/groups/${groupId}`, headers }),
        app.inject({ method: 'POST', url: `/api/groups/${groupId}/invites`, headers, payload: {} }),
        app.inject({
          method: 'POST', url: `/api/groups/${groupId}/channels`, headers,
          payload: { name: 'outro', type: 'text' },
        }),
        app.inject({ method: 'DELETE', url: `/api/groups/${groupId}/members/${beto.userId}`, headers }),
      ])
      for (const t of tentativas) expect(t.statusCode).toBe(404)

      // Sair tambem nao: conversa se fecha.
      const sair = await app.inject({
        method: 'DELETE', url: `/api/groups/${groupId}/members/${ana.userId}`, headers,
      })
      expect(sair.statusCode).toBe(409)
      expect(sair.json().error.code).toBe('dm_cannot_leave')
      await app.close()
    })
  })

  it('fechar tira so da minha lista, e a proxima mensagem reabre', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, beto } = await cenario(app, db)
      const { groupId, channelId } = (await abrir(app, ana, beto.userId)).json() as {
        groupId: string; channelId: string
      }

      const fechar = await app.inject({
        method: 'DELETE', url: `/api/dms/${groupId}`, headers: { cookie: beto.cookie },
      })
      expect(fechar.statusCode).toBe(204)

      const oculto = async (userId: string): Promise<boolean> => {
        const [m] = await db.select({ h: groupMembers.hiddenAt }).from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
        return m?.h != null
      }
      expect(await oculto(beto.userId)).toBe(true)
      expect(await oculto(ana.userId)).toBe(false)

      await enviar(app, ana, channelId, 'ainda ai?')
      expect(await oculto(beto.userId)).toBe(false)
      await app.close()
    })
  })

  it('fechar um grupo comum por esta rota e 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, grupo } = await cenario(app, db)
      const r = await app.inject({
        method: 'DELETE', url: `/api/dms/${grupo}`, headers: { cookie: ana.cookie },
      })
      expect(r.statusCode).toBe(404)
      await app.close()
    })
  })

  it('conversa nao conta no teto de grupos criados', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { ana, beto } = await cenario(app, db)
      const antes = await cotaDeGrupos(ana.userId)
      await abrir(app, ana, beto.userId)
      expect(await cotaDeGrupos(ana.userId)).toEqual(antes)
      await app.close()
    })
  })
})
