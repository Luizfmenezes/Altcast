import { and, eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { groupInvitations, groupMembers } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'
import type { Correio, Mensagem } from '../src/email/tipos.js'

/** Correio que guarda o que foi enviado, para o teste poder perguntar. */
function correioDeTeste(): Correio & { enviadas: Mensagem[] } {
  const enviadas: Mensagem[] = []
  return {
    enviadas,
    enviar: async (m: Mensagem) => { enviadas.push(m) },
  }
}

async function convidar(
  app: FastifyInstance, cookie: string, groupId: string, corpo: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST', url: `/api/groups/${groupId}/invitations`,
    headers: { cookie }, payload: corpo,
  })
}

describe('convite dirigido a uma pessoa', () => {
  it('a resposta nao revela se o endereco ja tem conta aqui', async () => {
    await withTestDb(async db => {
      const correio = correioDeTeste()
      const app = await buildServer({ correio })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      await loginComo(app, db, 'jaexiste@x.com', 'senha-longa-boa', '10.0.0.9')

      const comConta = await convidar(app, cookieDono, groupId, { email: 'jaexiste@x.com' })
      const semConta = await convidar(app, cookieDono, groupId, { email: 'ninguem@x.com' })

      expect(comConta.statusCode).toBe(201)
      expect(semConta.statusCode).toBe(201)
      // Mesmas chaves, mesmo formato: a unica diferenca entre as duas
      // respostas e o id, que e aleatorio nos dois casos.
      expect(Object.keys(comConta.json()).sort()).toEqual(Object.keys(semConta.json()).sort())
      expect(comConta.json().role).toBe(semConta.json().role)

      // A diferenca existe, mas so por dentro: e-mail sai apenas para quem
      // nao tem conta.
      expect(correio.enviadas).toHaveLength(1)
      expect(correio.enviadas[0]!.para).toBe('ninguem@x.com')
      await app.close()
    })
  })

  it('a listagem do grupo mostra o endereco, nunca o nome de exibicao', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      await loginComo(app, db, 'maria@x.com', 'senha-longa-boa', '10.0.0.8')
      await convidar(app, cookieDono, groupId, { email: 'maria@x.com' })

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${groupId}/invitations`, headers: { cookie: cookieDono },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(1)
      expect(res.json()[0].email).toBe('maria@x.com')
      // `displayName` seria "maria" e contaria, pela porta dos fundos, que
      // aquele endereco tem conta aqui.
      expect(Object.keys(res.json()[0]).sort())
        .toEqual(['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'role'])
      await app.close()
    })
  })

  it('quem tem conta ve o convite e entra ao aceitar', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await loginComo(app, db, 'ze@x.com', 'senha-longa-boa', '10.0.0.7')

      await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })

      const meus = await app.inject({
        method: 'GET', url: '/api/invitations', headers: { cookie: ze.cookie },
      })
      expect(meus.json()).toHaveLength(1)
      expect(meus.json()[0].group.name).toBe('Time')

      const id = meus.json()[0].id as string
      const aceite = await app.inject({
        method: 'POST', url: `/api/invitations/${id}/accept`, headers: { cookie: ze.cookie },
      })
      expect(aceite.statusCode).toBe(200)

      const [vinculo] = await db.select().from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, ze.userId)))
      expect(vinculo?.role).toBe('member')

      // Aceito some da lista: o estado e derivado dos carimbos, e nao ha
      // coluna de status para divergir dele.
      const depois = await app.inject({
        method: 'GET', url: '/api/invitations', headers: { cookie: ze.cookie },
      })
      expect(depois.json()).toHaveLength(0)
      await app.close()
    })
  })

  it('convite de outra pessoa responde igual a convite inexistente', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await loginComo(app, db, 'ze@x.com', 'senha-longa-boa', '10.0.0.6')
      const bisbilhoteiro = await loginComo(app, db, 'outro@x.com', 'senha-longa-boa', '10.0.0.5')

      await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })
      const [inv] = await db.select().from(groupInvitations)
        .where(eq(groupInvitations.targetUserId, ze.userId))

      const res = await app.inject({
        method: 'POST', url: `/api/invitations/${inv!.id}/accept`,
        headers: { cookie: bisbilhoteiro.cookie },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('invitation_not_found')
      await app.close()
    })
  })

  it('um pendente por pessoa por grupo; recusar libera um novo', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await loginComo(app, db, 'ze@x.com', 'senha-longa-boa', '10.0.0.4')

      expect((await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })).statusCode).toBe(201)
      const repetido = await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })
      expect(repetido.statusCode).toBe(409)
      expect(repetido.json().error.code).toBe('already_invited')

      const meus = await app.inject({
        method: 'GET', url: '/api/invitations', headers: { cookie: ze.cookie },
      })
      const recusa = await app.inject({
        method: 'POST', url: `/api/invitations/${meus.json()[0].id}/decline`,
        headers: { cookie: ze.cookie },
      })
      expect(recusa.statusCode).toBe(204)

      // A segunda chance e deliberada: quem disse nao hoje pode ser convidado
      // de novo amanha.
      expect((await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })).statusCode).toBe(201)
      await app.close()
    })
  })

  it('o cadastro resgata o convite enderecado ao endereco', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)

      await convidar(app, cookieDono, groupId, { email: 'novo@x.com' })

      const res = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'novo@x.com', password: 'senha-longa-boa', displayName: 'Novo' },
      })
      expect(res.statusCode).toBe(201)

      const cookie = (res.headers['set-cookie'] as string).split(';')[0]!
      const eu = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
      // Ja dentro do grupo, sem um segundo clique: quem foi convidado por
      // e-mail nem sabe que existe um convite a aceitar.
      expect(eu.json().groups.map((g: { id: string }) => g.id)).toContain(groupId)
      await app.close()
    })
  })

  it('member nao convida: a rota responde 404, e nao 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { groupId } = await cenarioComAdmin(app, db)
      const ze = await loginComo(app, db, 'ze@x.com', 'senha-longa-boa', '10.0.0.3')
      await db.insert(groupMembers).values({ groupId, userId: ze.userId, role: 'member' })

      const res = await convidar(app, ze.cookie, groupId, { email: 'alguem@x.com' })
      // Quem nao administra o grupo nem descobre que ele tem rota de convite.
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('o seletor so oferece quem ja compartilha um grupo comigo', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId, adminId } = await cenarioComAdmin(app, db)
      // Este existe, mas nao divide grupo nenhum com o dono.
      const estranho = await loginComo(app, db, 'estranho@x.com', 'senha-longa-boa', '10.0.0.2')

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${groupId}/invitable`, headers: { cookie: cookieDono },
      })
      expect(res.statusCode).toBe(200)
      const ids = res.json().map((p: { id: string }) => p.id)
      expect(ids).not.toContain(estranho.userId)
      // O admin ja e membro deste grupo; nao ha o que convidar.
      expect(ids).not.toContain(adminId)
      await app.close()
    })
  })

  it('revogar tira o convite da lista de quem recebeu', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ correio: correioDeTeste() })
      const { cookieDono, groupId } = await cenarioComAdmin(app, db)
      const ze = await loginComo(app, db, 'ze@x.com', 'senha-longa-boa', '10.0.0.1')

      const criado = await convidar(app, cookieDono, groupId, { email: 'ze@x.com' })
      const id = criado.json().id as string

      const res = await app.inject({
        method: 'DELETE', url: `/api/groups/${groupId}/invitations/${id}`,
        headers: { cookie: cookieDono },
      })
      expect(res.statusCode).toBe(204)

      const meus = await app.inject({
        method: 'GET', url: '/api/invitations', headers: { cookie: ze.cookie },
      })
      expect(meus.json()).toHaveLength(0)

      // Marcado, nao apagado: a linha guarda quem convidou quem.
      const [linha] = await db.select().from(groupInvitations)
        .where(eq(groupInvitations.id, id))
      expect(linha?.revokedAt).not.toBeNull()
      await app.close()
    })
  })
})
