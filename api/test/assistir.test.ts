import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { comServidor, conectar, escutar, esperarFrame } from './helpers/ws.js'
import { groupInvitations, groupMembers, users } from '../src/db/schema.js'
import { calls } from '../src/realtime/calls.js'
import { pedidos } from '../src/assistir/pedidos.js'

/**
 * "Assistir no Altcast": o botao do cartao do Discord.
 *
 * O link e publico — esta no perfil de quem transmite. Cada caso aqui prova uma
 * metade da mesma regra: o link so leva a um PEDIDO, e entrar no grupo continua
 * exigindo que alguem com permissao de convidar diga sim.
 */

async function criarCanal(
  app: FastifyInstance, groupId: string, cookie: string, campos: Record<string, unknown>,
): Promise<string> {
  const r = await app.inject({
    method: 'POST', url: `/api/groups/${groupId}/channels`, headers: { cookie }, payload: campos,
  })
  expect(r.statusCode).toBe(201)
  return r.json().id as string
}

beforeEach(() => { pedidos.clear() })

describe('assistir uma transmissao pelo link do Discord', () => {
  it('previa: publica enquanto quem convida esta na chamada, 404 quando sai', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        const url = `/api/assistir/${base.ownerId}/${voz}`

        expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)

        calls.join(voz, base.ownerId)
        calls.atualizar(voz, base.ownerId, { tela: true })
        const r = await app.inject({ method: 'GET', url })
        expect(r.statusCode).toBe(200)
        expect(r.json()).toMatchObject({ grupo: { name: 'Time' }, tela: true, membro: null })
        // A um estranho os ids nao servem para nada, e nao vao.
        expect(r.json().groupId).toBeUndefined()

        // Quem ja e membro recebe os ids, para a tela abrir o canal direto.
        const doAdmin = await app.inject({ method: 'GET', url, headers: { cookie: base.cookieAdmin } })
        expect(doAdmin.json()).toMatchObject({ membro: true, groupId: base.groupId, channelId: voz })

        calls.leave(voz, base.ownerId)
        expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)
      })
    })
  })

  it('canal privado e quem nao pode convidar nao abrem pedido', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const privada = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'diretoria', type: 'voice', visibility: 'private' })
        calls.join(privada, base.ownerId)
        expect((await app.inject({ method: 'GET', url: `/api/assistir/${base.ownerId}/${privada}` }))
          .statusCode).toBe(404)

        // Membro comum: sem `group.invite`, o link nao leva a lugar nenhum.
        const comum = await loginComo(app, db, 'comum@x.com')
        await db.insert(groupMembers).values({ groupId: base.groupId, userId: comum.userId, role: 'member' })
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        calls.join(voz, comum.userId)
        const r = await app.inject({ method: 'GET', url: `/api/assistir/${comum.userId}/${voz}` })
        expect(r.statusCode).toBe(404)
        expect(r.json().error.code).toBe('stream_unavailable')
      })
    })
  })

  it('pedido chega para quem transmite; aceitar poe a pessoa no grupo', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, wsUrl) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        calls.join(voz, base.ownerId)
        const amigo = await loginComo(app, db, 'amigo@x.com')

        const wsDono = await conectar(wsUrl, base.cookieDono)
        const doDono = escutar(wsDono)
        const wsAmigo = await conectar(wsUrl, amigo.cookie)
        const doAmigo = escutar(wsAmigo)
        await esperarFrame(doDono, 'ready')
        await esperarFrame(doAmigo, 'ready')

        const pedir = (): Promise<{ statusCode: number; json: () => { id: string } }> => app.inject({
          method: 'POST', url: `/api/assistir/${base.ownerId}/${voz}/pedido`,
          headers: { cookie: amigo.cookie },
        })
        const r = await pedir()
        expect(r.statusCode).toBe(202)
        // Clicar de novo nao vira um segundo cartao.
        expect((await pedir()).json().id).toBe(r.json().id)

        const recebido = await esperarFrame(doDono, 'watch_request.received')
        expect(recebido.d).toMatchObject({
          id: r.json().id, groupName: 'Time', channelId: voz,
          solicitante: { id: amigo.userId },
        })
        expect(doDono.filter(f => f.t === 'watch_request.received')).toHaveLength(1)

        // Ninguem alem de quem transmite responde — nem o admin do grupo.
        const alheio = await app.inject({
          method: 'POST', url: `/api/pedidos-para-assistir/${r.json().id}/aceitar`,
          headers: { cookie: base.cookieAdmin },
        })
        expect(alheio.statusCode).toBe(404)

        const aceite = await app.inject({
          method: 'POST', url: `/api/pedidos-para-assistir/${r.json().id}/aceitar`,
          headers: { cookie: base.cookieDono },
        })
        expect(aceite.statusCode).toBe(204)

        const [membro] = await db.select().from(groupMembers).where(and(
          eq(groupMembers.groupId, base.groupId), eq(groupMembers.userId, amigo.userId)))
        expect(membro?.role).toBe('member')
        const [registro] = await db.select().from(groupInvitations)
          .where(eq(groupInvitations.targetUserId, amigo.userId))
        expect(registro?.invitedBy).toBe(base.ownerId)
        expect(registro?.acceptedAt).not.toBeNull()

        // O grupo chega ANTES do aceite: quando a tela for abrir o canal, ele
        // ja esta na store.
        await esperarFrame(doAmigo, 'watch_request.accepted')
        const ordem = doAmigo.map(f => f.t)
        expect(ordem.indexOf('group.joined')).toBeGreaterThanOrEqual(0)
        expect(ordem.indexOf('group.joined')).toBeLessThan(ordem.indexOf('watch_request.accepted'))

        // Pedido respondido nao responde de novo.
        expect((await app.inject({
          method: 'POST', url: `/api/pedidos-para-assistir/${r.json().id}/recusar`,
          headers: { cookie: base.cookieDono },
        })).statusCode).toBe(404)

        wsDono.close()
        wsAmigo.close()
      })
    })
  })

  it('recusar avisa quem pediu e nao poe ninguem no grupo', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, wsUrl) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        calls.join(voz, base.ownerId)
        const amigo = await loginComo(app, db, 'amigo@x.com')
        const ws = await conectar(wsUrl, amigo.cookie)
        const frames = escutar(ws)
        await esperarFrame(frames, 'ready')

        const r = await app.inject({
          method: 'POST', url: `/api/assistir/${base.ownerId}/${voz}/pedido`, headers: { cookie: amigo.cookie },
        })
        const lista = await app.inject({
          method: 'GET', url: '/api/pedidos-para-assistir', headers: { cookie: base.cookieDono },
        })
        expect(lista.json()).toHaveLength(1)

        await app.inject({
          method: 'POST', url: `/api/pedidos-para-assistir/${r.json().id}/recusar`,
          headers: { cookie: base.cookieDono },
        })
        await esperarFrame(frames, 'watch_request.declined')
        const dentro = await db.select().from(groupMembers).where(and(
          eq(groupMembers.groupId, base.groupId), eq(groupMembers.userId, amigo.userId)))
        expect(dentro).toHaveLength(0)
        ws.close()
      })
    })
  })

  it('quem ja e membro recebe o caminho do canal em vez de um pedido', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        calls.join(voz, base.ownerId)
        const r = await app.inject({
          method: 'POST', url: `/api/assistir/${base.ownerId}/${voz}/pedido`, headers: { cookie: base.cookieAdmin },
        })
        expect(r.statusCode).toBe(409)
        expect(r.json().error).toMatchObject({
          code: 'already_member', details: { groupId: base.groupId, channelId: voz },
        })
      })
    })
  })

  it('quem transmite sem e-mail confirmado nao recebe pedido', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono, { name: 'sala', type: 'voice' })
        await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, base.ownerId))
        calls.join(voz, base.ownerId)
        expect((await app.inject({ method: 'GET', url: `/api/assistir/${base.ownerId}/${voz}` }))
          .statusCode).toBe(404)
      })
    })
  })

  it('o Client ID do Discord vem do servidor (nulo sem configuracao)', async () => {
    await withTestDb(async () => {
      await comServidor(async app => {
        const r = await app.inject({ method: 'GET', url: '/api/discord' })
        expect(r.statusCode).toBe(200)
        expect(r.json()).toHaveProperty('clientId')
      })
    })
  })
})
