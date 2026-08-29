import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { channels, groupMembers, messages } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'

describe('canais publicos', () => {
  it('admin cria canal; member nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieAdmin } = await cenarioComAdmin(app, db)

      const criado = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieAdmin }, payload: { name: 'avisos' },
      })
      expect(criado.statusCode).toBe(201)
      expect(criado.json()).toMatchObject({ name: 'avisos', type: 'text', visibility: 'public' })

      const membro = await loginComo(app, db, 'membro@x.com')
      await db.insert(groupMembers).values({ groupId, userId: membro.userId, role: 'member' })

      const negado = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: membro.cookie }, payload: { name: 'tentativa' },
      })
      expect(negado.statusCode).toBe(404)
      await app.close()
    })
  })

  it('recusa nome duplicado no mesmo grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const primeiro = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'avisos' },
      })
      expect(primeiro.statusCode).toBe(201)

      const repetido = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'avisos' },
      })
      expect(repetido.statusCode).toBe(409)
      expect(repetido.json().error.code).toBe('channel_name_taken')
      await app.close()
    })
  })

  it('normaliza o nome para minusculas com hifen', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'Planejamento Semanal' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().name).toBe('planejamento-semanal')

      const acentos = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: '  Ação & Reação!  ' },
      })
      expect(acentos.json().name).toBe('acao-reacao')
      await app.close()
    })
  })

  it('recusa nome que normaliza para vazio', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: '???' },
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  it('lista ordenada por position', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      for (const name of ['beta', 'alfa', 'gama']) {
        await app.inject({
          method: 'POST', url: `/api/groups/${groupId}/channels`,
          headers: { cookie: cookieDono }, payload: { name },
        })
      }

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono },
      })
      expect(res.statusCode).toBe(200)
      // 'geral' nasce em position 0 com o grupo; os demais entram na ordem de criacao.
      expect(res.json().map((c: { name: string }) => c.name))
        .toEqual(['geral', 'beta', 'alfa', 'gama'])
      await app.close()
    })
  })

  it('reordena por position no PATCH', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const novo = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'avisos' },
      })
      const canalId = novo.json().id as string

      const patch = await app.inject({
        method: 'PATCH', url: `/api/channels/${canalId}`,
        headers: { cookie: cookieDono }, payload: { position: -1, topic: 'quadro de avisos' },
      })
      expect(patch.statusCode).toBe(200)
      expect(patch.json()).toMatchObject({ position: -1, topic: 'quadro de avisos' })

      const lista = await app.inject({
        method: 'GET', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono },
      })
      expect(lista.json().map((c: { name: string }) => c.name)).toEqual(['avisos', 'geral'])
      await app.close()
    })
  })

  it('apagar canal apaga suas mensagens', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const novo = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'avisos' },
      })
      const canalId = novo.json().id as string
      await db.insert(messages).values({
        id: newId(), channelId: canalId, authorId: null, content: 'ola',
      })

      const apagado = await app.inject({
        method: 'DELETE', url: `/api/channels/${canalId}`, headers: { cookie: cookieDono },
      })
      expect(apagado.statusCode).toBe(204)

      const restam = await db.select().from(messages).where(eq(messages.channelId, canalId))
      expect(restam).toHaveLength(0)
      const canais = await db.select().from(channels).where(eq(channels.id, canalId))
      expect(canais).toHaveLength(0)
      await app.close()
    })
  })

  it('canal de voz e criado e se declara como voz', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'sala', type: 'voice' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ name: 'sala', type: 'voice' })
      await app.close()
    })
  })

  it('sem tipo declarado, o canal nasce de texto', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'avisos' },
      })
      expect(res.json().type).toBe('text')
      await app.close()
    })
  })

  it('tipo inventado continua recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId, cookieDono } = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: cookieDono }, payload: { name: 'sala', type: 'holograma' },
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  it('estranho ao grupo nao lista nem cria', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId } = await cenarioComAdmin(app, db)
      const estranho = await loginComo(app, db, 'estranho@x.com')

      const lista = await app.inject({
        method: 'GET', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: estranho.cookie },
      })
      expect(lista.statusCode).toBe(404)

      const cria = await app.inject({
        method: 'POST', url: `/api/groups/${groupId}/channels`,
        headers: { cookie: estranho.cookie }, payload: { name: 'invasao' },
      })
      expect(cria.statusCode).toBe(404)
      await app.close()
    })
  })

  it('exige autenticacao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { groupId } = await cenarioComAdmin(app, db)
      const res = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/channels` })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })
})
