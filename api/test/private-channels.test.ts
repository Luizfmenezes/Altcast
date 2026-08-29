import { and, eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { channelMembers, groupMembers } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'
import type { FastifyInstance } from 'fastify'

/**
 * Grupo com dono, admin e dois members, mais um canal privado criado pela rota
 * com o member `dentro` na lista de acesso. O admin fica deliberadamente FORA:
 * e o cenario que separa administrar de ler.
 */
async function cenario(app: FastifyInstance, db: Database): Promise<{
  groupId: string; canalId: string
  cookieDono: string; cookieAdmin: string
  cookieDentro: string; idDentro: string
  cookieFora: string; idFora: string
  cookieEstranho: string; idEstranho: string
}> {
  const base = await cenarioComAdmin(app, db)

  const dentro = await loginComo(app, db, 'dentro@x.com')
  const fora = await loginComo(app, db, 'fora@x.com')
  const estranho = await loginComo(app, db, 'estranho@x.com')
  await db.insert(groupMembers).values([
    { groupId: base.groupId, userId: dentro.userId, role: 'member' },
    { groupId: base.groupId, userId: fora.userId, role: 'member' },
  ])

  const criado = await app.inject({
    method: 'POST', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
    payload: { name: 'diretoria', visibility: 'private' },
  })
  const canalId = criado.json().id as string

  await app.inject({
    method: 'POST', url: `/api/channels/${canalId}/members`,
    headers: { cookie: base.cookieDono }, payload: { userId: dentro.userId },
  })

  return {
    groupId: base.groupId, canalId,
    cookieDono: base.cookieDono, cookieAdmin: base.cookieAdmin,
    cookieDentro: dentro.cookie, idDentro: dentro.userId,
    cookieFora: fora.cookie, idFora: fora.userId,
    cookieEstranho: estranho.cookie, idEstranho: estranho.userId,
  }
}

describe('canais privados', () => {
  it('nao aparece na listagem de quem nao participa', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieFora },
      })
      expect(res.statusCode).toBe(200)
      const nomes = res.json().map((canal: { name: string }) => canal.name)
      expect(nomes).not.toContain('diretoria')
      expect(JSON.stringify(res.json())).not.toContain(c.canalId)

      const deDentro = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieDentro },
      })
      expect(deDentro.json().map((canal: { name: string }) => canal.name)).toContain('diretoria')
      await app.close()
    })
  })

  it('admin fora do canal nao le, mas apaga', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const leitura = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}`, headers: { cookie: c.cookieAdmin },
      })
      expect(leitura.statusCode).toBe(404)

      const listagem = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(JSON.stringify(listagem.json())).not.toContain(c.canalId)

      const apagar = await app.inject({
        method: 'DELETE', url: `/api/channels/${c.canalId}`, headers: { cookie: c.cookieAdmin },
      })
      expect(apagar.statusCode).toBe(204)
      await app.close()
    })
  })

  it('participante le o canal', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}`, headers: { cookie: c.cookieDentro },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ name: 'diretoria', visibility: 'private' })
      await app.close()
    })
  })

  it('criador entra automaticamente na lista', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      const criado = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/channels`,
        headers: { cookie: base.cookieAdmin },
        payload: { name: 'sigiloso', visibility: 'private' },
      })
      expect(criado.statusCode).toBe(201)

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, criado.json().id as string))
      expect(lista.map(m => m.userId)).toEqual([base.adminId])
      await app.close()
    })
  })

  it('so aceita membro que ja pertence ao grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/channels/${c.canalId}/members`,
        headers: { cookie: c.cookieDono }, payload: { userId: c.idEstranho },
      })
      expect(res.statusCode).toBe(404)

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, c.canalId))
      expect(lista.map(m => m.userId)).not.toContain(c.idEstranho)
      await app.close()
    })
  })

  it('member do canal nao gerencia a lista de acesso', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/channels/${c.canalId}/members`,
        headers: { cookie: c.cookieDentro }, payload: { userId: c.idFora },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('quem nao participa nem administra nao ve a lista de acesso', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const doDentro = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/members`,
        headers: { cookie: c.cookieDentro },
      })
      expect(doDentro.statusCode).toBe(200)
      expect(doDentro.json().map((m: { userId: string }) => m.userId)).toContain(c.idDentro)

      const doFora = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/members`,
        headers: { cookie: c.cookieFora },
      })
      expect(doFora.statusCode).toBe(404)
      await app.close()
    })
  })

  it('remover do canal nao remove do grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'DELETE', url: `/api/channels/${c.canalId}/members/${c.idDentro}`,
        headers: { cookie: c.cookieDono },
      })
      expect(res.statusCode).toBe(204)

      const noCanal = await db.select().from(channelMembers)
        .where(and(
          eq(channelMembers.channelId, c.canalId), eq(channelMembers.userId, c.idDentro),
        ))
      expect(noCanal).toHaveLength(0)

      const noGrupo = await db.select().from(groupMembers)
        .where(and(eq(groupMembers.groupId, c.groupId), eq(groupMembers.userId, c.idDentro)))
      expect(noGrupo).toHaveLength(1)
      await app.close()
    })
  })

  it('participante sai do canal sozinho', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'DELETE', url: `/api/channels/${c.canalId}/members/${c.idDentro}`,
        headers: { cookie: c.cookieDentro },
      })
      expect(res.statusCode).toBe(204)

      const depois = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}`, headers: { cookie: c.cookieDentro },
      })
      expect(depois.statusCode).toBe(404)
      await app.close()
    })
  })

  it('canal publico nao usa channel_members', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      const criado = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/channels`,
        headers: { cookie: base.cookieDono }, payload: { name: 'aberto' },
      })
      const canalId = criado.json().id as string

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, canalId))
      expect(lista).toHaveLength(0)

      const tentativa = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/members`,
        headers: { cookie: base.cookieDono }, payload: { userId: base.adminId },
      })
      expect(tentativa.statusCode).toBe(422)
      await app.close()
    })
  })

  it('tornar publico um canal privado limpa a lista de acesso', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'PATCH', url: `/api/channels/${c.canalId}`,
        headers: { cookie: c.cookieDono }, payload: { visibility: 'public' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().visibility).toBe('public')

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, c.canalId))
      expect(lista).toHaveLength(0)

      // Agora que e publico, quem estava de fora enxerga.
      const doFora = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieFora },
      })
      expect(doFora.json().map((canal: { name: string }) => canal.name)).toContain('diretoria')
      await app.close()
    })
  })

  it('tornar privado um canal publico coloca so quem fez a mudanca', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      const criado = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/channels`,
        headers: { cookie: base.cookieDono }, payload: { name: 'aberto' },
      })
      const canalId = criado.json().id as string

      const res = await app.inject({
        method: 'PATCH', url: `/api/channels/${canalId}`,
        headers: { cookie: base.cookieDono }, payload: { visibility: 'private' },
      })
      expect(res.statusCode).toBe(200)

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, canalId))
      expect(lista.map(m => m.userId)).toEqual([base.ownerId])
      await app.close()
    })
  })

  it('sair do grupo remove das listas de acesso do grupo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'DELETE', url: `/api/groups/${c.groupId}/members/${c.idDentro}`,
        headers: { cookie: c.cookieDentro },
      })
      expect(res.statusCode).toBe(204)

      const lista = await db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, c.canalId))
      expect(lista.map(m => m.userId)).not.toContain(c.idDentro)
      await app.close()
    })
  })
})
