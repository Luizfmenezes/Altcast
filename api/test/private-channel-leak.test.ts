import { and, eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import {
  comServidor, conectado, conectar, espere, esperarFrame, primeiroFrame,
} from './helpers/ws.js'
import { channelMembers, groupMembers } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'

/**
 * Os onze casos da spec 06 secao 5. Este arquivo existe separado de proposito:
 * canal privado e o unico ponto do sistema onde um erro vaza conteudo alheio, e
 * nenhuma alteracao em `can.ts` ou `fanout.ts` entra sem passar por aqui.
 *
 * Todos os casos partem do mesmo cenario — um canal privado com um unico
 * participante — para que a diferenca entre eles seja so o caminho testado.
 */
type Cenario = {
  groupId: string; privado: string
  cookieDono: string; idDono: string
  cookieAdmin: string; idAdmin: string
  cookieDentro: string; idDentro: string
  cookieFora: string; idFora: string
}

async function cenario(app: FastifyInstance, db: Database): Promise<Cenario> {
  const base = await cenarioComAdmin(app, db)
  const dentro = await loginComo(app, db, 'dentro@x.com')
  const fora = await loginComo(app, db, 'fora@x.com')
  await db.insert(groupMembers).values([
    { groupId: base.groupId, userId: dentro.userId, role: 'member' },
    { groupId: base.groupId, userId: fora.userId, role: 'member' },
  ])

  const criado = await app.inject({
    method: 'POST', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
    payload: { name: 'demissoes-q4', visibility: 'private' },
  })
  const privado = criado.json().id as string

  await app.inject({
    method: 'POST', url: `/api/channels/${privado}/members`,
    headers: { cookie: base.cookieDono }, payload: { userId: dentro.userId },
  })

  return {
    groupId: base.groupId, privado,
    cookieDono: base.cookieDono, idDono: base.ownerId,
    cookieAdmin: base.cookieAdmin, idAdmin: base.adminId,
    cookieDentro: dentro.cookie, idDentro: dentro.userId,
    cookieFora: fora.cookie, idFora: fora.userId,
  }
}

describe('canal privado nao vaza', () => {
  it('o ready de nao-membro nao traz o canal, nem com ID', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const ws = await conectar(url, c.cookieFora)
        const ready = await primeiroFrame(ws)

        expect(ready.t).toBe('ready')
        const bruto = JSON.stringify(ready)
        expect(bruto).not.toContain(c.privado)
        expect(bruto).not.toContain('demissoes-q4')
        ws.close()
      })
    })
  })

  it('GET /channels devolve lista filtrada', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieFora },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.stringify(res.json())).not.toContain(c.privado)
      await app.close()
    })
  })

  it('GET /channels/:id devolve 404, nunca 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}`, headers: { cookie: c.cookieFora },
      })
      // 403 confirmaria que o canal existe. Invisivel, nao trancado.
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
      await app.close()
    })
  })

  it('GET /channels/:id/messages devolve 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}/messages`,
        headers: { cookie: c.cookieFora },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('POST de mensagem por nao-membro devolve 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'POST', url: `/api/channels/${c.privado}/messages`,
        headers: { cookie: c.cookieFora }, payload: { content: 'entrei?' },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('o fan-out de message.created nao alcanca nao-membro', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const dentro = await conectado(url, c.cookieDentro)
        const fora = await conectado(url, c.cookieFora)
        const admin = await conectado(url, c.cookieAdmin)

        await app.inject({
          method: 'POST', url: `/api/channels/${c.privado}/messages`,
          headers: { cookie: c.cookieDentro }, payload: { content: 'lista final' },
        })

        await esperarFrame(dentro.frames, 'message.created')
        await espere(300)
        // O admin administra o canal e ainda assim nao recebe: administrar nao
        // e ler, nem no REST nem no socket.
        for (const lado of [fora, admin]) {
          expect(lado.frames.filter(f => f.t.startsWith('message.'))).toHaveLength(0)
          expect(JSON.stringify(lado.frames)).not.toContain('lista final')
        }

        dentro.ws.close(); fora.ws.close(); admin.ws.close()
      })
    })
  })

  it('a adicao ao canal so avisa quem foi adicionado', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const novo = await conectado(url, c.cookieFora)
        const dentro = await conectado(url, c.cookieDentro)

        await app.inject({
          method: 'POST', url: `/api/channels/${c.privado}/members`,
          headers: { cookie: c.cookieDono }, payload: { userId: c.idFora },
        })

        const frame = await esperarFrame(novo.frames, 'channel.created')
        expect(frame.d).toMatchObject({ id: c.privado })
        await espere(300)
        expect(dentro.frames.filter(f => f.t.startsWith('channel.'))).toHaveLength(0)

        novo.ws.close(); dentro.ws.close()
      })
    })
  })

  it('a remocao do canal so avisa quem foi removido', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const removido = await conectado(url, c.cookieDentro)
        const dono = await conectado(url, c.cookieDono)

        await app.inject({
          method: 'DELETE', url: `/api/channels/${c.privado}/members/${c.idDentro}`,
          headers: { cookie: c.cookieDono },
        })

        const frame = await esperarFrame(removido.frames, 'channel.deleted')
        expect(frame.d).toMatchObject({ id: c.privado })
        await espere(300)
        expect(dono.frames.filter(f => f.t === 'channel.deleted')).toHaveLength(0)

        removido.ws.close(); dono.ws.close()
      })
    })
  })

  it('mensagem enviada depois da remocao nao alcanca o removido', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const removido = await conectado(url, c.cookieDentro)

        await app.inject({
          method: 'DELETE', url: `/api/channels/${c.privado}/members/${c.idDentro}`,
          headers: { cookie: c.cookieDono },
        })
        await esperarFrame(removido.frames, 'channel.deleted')

        // A partir daqui ele nao pertence mais a audiencia. O socket segue
        // aberto de proposito: e o caminho pelo qual o vazamento aconteceria.
        await app.inject({
          method: 'POST', url: `/api/channels/${c.privado}/messages`,
          headers: { cookie: c.cookieDono }, payload: { content: 'depois da saida' },
        })
        await espere(400)

        expect(removido.frames.filter(f => f.t.startsWith('message.'))).toHaveLength(0)
        expect(JSON.stringify(removido.frames)).not.toContain('depois da saida')

        // E o REST concorda com o socket: a porta fechou dos dois lados.
        const leitura = await app.inject({
          method: 'GET', url: `/api/channels/${c.privado}/messages`,
          headers: { cookie: c.cookieDentro },
        })
        expect(leitura.statusCode).toBe(404)

        removido.ws.close()
      })
    })
  })

  it('sair do grupo remove de todos os canais privados dele', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const saida = await app.inject({
        method: 'DELETE', url: `/api/groups/${c.groupId}/members/${c.idDentro}`,
        headers: { cookie: c.cookieDentro },
      })
      expect(saida.statusCode).toBe(204)

      // channel_members referencia channels e users, jamais group_members:
      // sem a limpeza explicita da rota, o acesso sobreviveria a saida e
      // ressuscitaria numa readmissao.
      const restante = await db.select().from(channelMembers).where(and(
        eq(channelMembers.channelId, c.privado), eq(channelMembers.userId, c.idDentro),
      ))
      expect(restante).toHaveLength(0)

      const leitura = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}`, headers: { cookie: c.cookieDentro },
      })
      expect(leitura.statusCode).toBe(404)
      await app.close()
    })
  })

  it('admin sem acesso apaga o canal, mas nunca o le', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const conteudo = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}`, headers: { cookie: c.cookieAdmin },
      })
      expect(conteudo.statusCode).toBe(404)

      const historico = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}/messages`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(historico.statusCode).toBe(404)

      // A lista de acesso e a unica excecao da spec 03 secao 9: quem administra
      // ve os nomes, porque precisa administrar. O conteudo continua fechado.
      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${c.privado}/members`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(lista.statusCode).toBe(200)

      const apagar = await app.inject({
        method: 'DELETE', url: `/api/channels/${c.privado}`, headers: { cookie: c.cookieAdmin },
      })
      expect(apagar.statusCode).toBe(204)
      await app.close()
    })
  })

  it('o canal some do ready de quem foi removido', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const c = await cenario(app, db)
        const antes = await conectar(url, c.cookieDentro)
        expect(JSON.stringify(await primeiroFrame(antes))).toContain(c.privado)
        antes.close()

        await app.inject({
          method: 'DELETE', url: `/api/channels/${c.privado}/members/${c.idDentro}`,
          headers: { cookie: c.cookieDono },
        })

        const depois = await conectar(url, c.cookieDentro)
        const ready = await primeiroFrame(depois)
        expect(JSON.stringify(ready)).not.toContain(c.privado)
        expect(JSON.stringify(ready)).not.toContain('demissoes-q4')
        depois.close()
      })
    })
  })
})
