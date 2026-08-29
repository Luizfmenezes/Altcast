import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { groupMembers, messages } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'
import type { FastifyInstance } from 'fastify'

type Cenario = {
  groupId: string; canalId: string
  cookieDono: string; cookieAdmin: string
  cookieMembro: string; idMembro: string
  cookieOutro: string; idOutro: string
}

/** Grupo com dono, admin e dois members, e o canal publico #geral. */
async function cenario(app: FastifyInstance, db: Database): Promise<Cenario> {
  const base = await cenarioComAdmin(app, db)

  const membro = await loginComo(app, db, 'membro@x.com')
  const outro = await loginComo(app, db, 'outro@x.com')
  await db.insert(groupMembers).values([
    { groupId: base.groupId, userId: membro.userId, role: 'member' },
    { groupId: base.groupId, userId: outro.userId, role: 'member' },
  ])

  const canais = await app.inject({
    method: 'GET', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
  })
  const canalId = canais.json()[0].id as string

  return {
    groupId: base.groupId, canalId,
    cookieDono: base.cookieDono, cookieAdmin: base.cookieAdmin,
    cookieMembro: membro.cookie, idMembro: membro.userId,
    cookieOutro: outro.cookie, idOutro: outro.userId,
  }
}

function enviar(
  app: FastifyInstance, canalId: string, cookie: string, payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST', url: `/api/channels/${canalId}/messages`, headers: { cookie }, payload,
  })
}

describe('mensagens', () => {
  it('pagina por cursor, do mais novo para o mais antigo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const ids: string[] = []
      for (let i = 0; i < 120; i++) ids.push(newId())
      await db.insert(messages).values(ids.map((id, i) => ({
        id, channelId: c.canalId, authorId: c.idMembro, content: `msg ${i}`,
      })))

      const primeira = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages?limit=50`,
        headers: { cookie: c.cookieMembro },
      })
      expect(primeira.statusCode).toBe(200)
      const p1 = primeira.json() as { id: string }[]
      expect(p1).toHaveLength(50)
      // Mais novo primeiro: os ultimos criados encabecam a lista.
      expect(p1[0]!.id).toBe(ids[119])

      const segunda = await app.inject({
        method: 'GET',
        url: `/api/channels/${c.canalId}/messages?limit=50&before=${p1[49]!.id}`,
        headers: { cookie: c.cookieMembro },
      })
      const p2 = segunda.json() as { id: string }[]
      expect(p2).toHaveLength(50)
      expect(p2[0]!.id).toBe(ids[69])

      const repetidos = p1.map(m => m.id).filter(id => p2.some(m => m.id === id))
      expect(repetidos).toHaveLength(0)
      await app.close()
    })
  })

  it('limita o tamanho da pagina a 100', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      await db.insert(messages).values(Array.from({ length: 120 }, (_, i) => ({
        id: newId(), channelId: c.canalId, authorId: c.idMembro, content: `msg ${i}`,
      })))

      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages?limit=500`,
        headers: { cookie: c.cookieMembro },
      })
      expect(res.json()).toHaveLength(100)
      await app.close()
    })
  })

  it('aceita o ID gerado pelo cliente para eco otimista', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const id = newId()
      const res = await enviar(app, c.canalId, c.cookieMembro, { id, content: 'ola' })
      expect(res.statusCode).toBe(201)
      expect(res.json().id).toBe(id)
      expect(res.json()).toMatchObject({ content: 'ola', authorId: c.idMembro })
      await app.close()
    })
  })

  it('gera o ID quando o cliente nao manda', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await enviar(app, c.canalId, c.cookieMembro, { content: 'sem id' })
      expect(res.statusCode).toBe(201)
      expect(res.json().id).toMatch(/^[0-9a-f-]{36}$/)
      await app.close()
    })
  })

  it('recusa ID que nao seja UUIDv7', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      // UUIDv4 valido como UUID, mas sem a ordenacao cronologica que a
      // paginacao por cursor exige.
      const res = await enviar(app, c.canalId, c.cookieMembro, {
        id: '9f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6071', content: 'ola',
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  it('recusa ID ja existente', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const id = newId()
      expect((await enviar(app, c.canalId, c.cookieMembro, { id, content: 'um' })).statusCode)
        .toBe(201)
      const repetido = await enviar(app, c.canalId, c.cookieMembro, { id, content: 'dois' })
      expect(repetido.statusCode).toBe(409)
      expect(repetido.json().error.code).toBe('message_id_taken')
      await app.close()
    })
  })

  it('soft delete some da listagem mas a linha permanece', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const criada = await enviar(app, c.canalId, c.cookieMembro, { content: 'apagavel' })
      const id = criada.json().id as string

      const apagada = await app.inject({
        method: 'DELETE', url: `/api/messages/${id}`, headers: { cookie: c.cookieMembro },
      })
      expect(apagada.statusCode).toBe(204)

      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages`,
        headers: { cookie: c.cookieMembro },
      })
      expect(lista.json().map((m: { id: string }) => m.id)).not.toContain(id)

      const [linha] = await db.select().from(messages).where(eq(messages.id, id))
      expect(linha).toBeDefined()
      expect(linha!.deletedAt).not.toBeNull()
      await app.close()
    })
  })

  it('autor edita a propria; terceiro nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const criada = await enviar(app, c.canalId, c.cookieMembro, { content: 'original' })
      const id = criada.json().id as string

      const propria = await app.inject({
        method: 'PATCH', url: `/api/messages/${id}`,
        headers: { cookie: c.cookieMembro }, payload: { content: 'editada' },
      })
      expect(propria.statusCode).toBe(200)
      expect(propria.json().content).toBe('editada')
      expect(propria.json().editedAt).not.toBeNull()

      const alheia = await app.inject({
        method: 'PATCH', url: `/api/messages/${id}`,
        headers: { cookie: c.cookieOutro }, payload: { content: 'invasao' },
      })
      expect(alheia.statusCode).toBe(404)

      // Nem o admin edita mensagem de terceiro: editar e do autor, so.
      const doAdmin = await app.inject({
        method: 'PATCH', url: `/api/messages/${id}`,
        headers: { cookie: c.cookieAdmin }, payload: { content: 'moderada' },
      })
      expect(doAdmin.statusCode).toBe(404)
      await app.close()
    })
  })

  it('admin apaga a de terceiro; member nao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const primeira = await enviar(app, c.canalId, c.cookieMembro, { content: 'uma' })
      const doOutro = await app.inject({
        method: 'DELETE', url: `/api/messages/${primeira.json().id}`,
        headers: { cookie: c.cookieOutro },
      })
      expect(doOutro.statusCode).toBe(404)

      const doAdmin = await app.inject({
        method: 'DELETE', url: `/api/messages/${primeira.json().id}`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(doAdmin.statusCode).toBe(204)
      await app.close()
    })
  })

  it('nao-membro do canal privado recebe 404 ao listar e ao enviar', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const criado = await app.inject({
        method: 'POST', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieDono },
        payload: { name: 'diretoria', visibility: 'private' },
      })
      const privado = criado.json().id as string

      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${privado}/messages`,
        headers: { cookie: c.cookieMembro },
      })
      expect(lista.statusCode).toBe(404)

      const envio = await enviar(app, privado, c.cookieMembro, { content: 'oi' })
      expect(envio.statusCode).toBe(404)

      // O dono criou o canal, portanto esta dentro dele.
      expect((await enviar(app, privado, c.cookieDono, { content: 'oi' })).statusCode).toBe(201)
      await app.close()
    })
  })

  it('estranho ao grupo recebe 404 em canal publico', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const estranho = await loginComo(app, db, 'estranho@x.com')

      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages`,
        headers: { cookie: estranho.cookie },
      })
      expect(lista.statusCode).toBe(404)
      expect((await enviar(app, c.canalId, estranho.cookie, { content: 'oi' })).statusCode)
        .toBe(404)
      await app.close()
    })
  })

  it('recusa conteudo vazio ou acima de 4000 caracteres', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      expect((await enviar(app, c.canalId, c.cookieMembro, { content: '   ' })).statusCode)
        .toBe(422)
      expect((await enviar(app, c.canalId, c.cookieMembro, { content: 'x'.repeat(4001) }))
        .statusCode).toBe(422)
      expect((await enviar(app, c.canalId, c.cookieMembro, { content: 'x'.repeat(4000) }))
        .statusCode).toBe(201)
      await app.close()
    })
  })

  it('?after=<id> devolve o que chegou depois, para reconexao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const ids = Array.from({ length: 10 }, () => newId())
      await db.insert(messages).values(ids.map((id, i) => ({
        id, channelId: c.canalId, authorId: c.idMembro, content: `msg ${i}`,
      })))

      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages?after=${ids[6]}`,
        headers: { cookie: c.cookieMembro },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().map((m: { id: string }) => m.id)).toEqual([ids[9], ids[8], ids[7]])
      await app.close()
    })
  })

  it('exige autenticacao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages`,
      })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })
})
