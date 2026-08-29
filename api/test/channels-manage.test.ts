import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { groupMembers } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'

/**
 * A UNICA excecao a regra de invisibilidade da spec 03 secao 9: na tela de
 * configuracoes do grupo, owner e admin veem os NOMES dos canais privados
 * porque precisam administra-los. O conteudo continua fora de alcance, e o
 * proprio contrato da resposta diz isso.
 */
async function cenario(app: FastifyInstance, db: Database) {
  const base = await cenarioComAdmin(app, db)
  const membro = await loginComo(app, db, 'membro@x.com')
  await db.insert(groupMembers)
    .values({ groupId: base.groupId, userId: membro.userId, role: 'member' })

  const criado = await app.inject({
    method: 'POST', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
    payload: { name: 'diretoria', visibility: 'private' },
  })
  return { ...base, privado: criado.json().id as string, membro }
}

describe('listagem de administracao de canais', () => {
  it('admin ve o nome do canal privado que nao pode ler', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const gestao = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels/manage`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(gestao.statusCode).toBe(200)

      const canais = gestao.json() as { name: string; contentAccessible: boolean }[]
      expect(canais.map(x => x.name)).toContain('diretoria')

      const privado = canais.find(x => x.name === 'diretoria')!
      // O contrato diz explicitamente que administrar nao abriu a porta.
      expect(privado.contentAccessible).toBe(false)
      expect(canais.find(x => x.name === 'geral')!.contentAccessible).toBe(true)

      // E a listagem normal continua sem o canal: a excecao vale so aqui.
      const normal = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieAdmin },
      })
      expect(JSON.stringify(normal.json())).not.toContain('diretoria')
      await app.close()
    })
  })

  it('quem participa do canal privado ve que o conteudo esta acessivel', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const gestao = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels/manage`,
        headers: { cookie: c.cookieDono },
      })
      const privado = (gestao.json() as { name: string; contentAccessible: boolean }[])
        .find(x => x.name === 'diretoria')!
      // O dono criou o canal, portanto entrou nele.
      expect(privado.contentAccessible).toBe(true)
      await app.close()
    })
  })

  it('member comum nao alcanca a listagem de administracao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels/manage`,
        headers: { cookie: c.membro.cookie },
      })
      // Sem o papel, nem a existencia da tela se confirma.
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('estranho ao grupo recebe 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const estranho = await loginComo(app, db, 'estranho@x.com')

      const res = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels/manage`,
        headers: { cookie: estranho.cookie },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('a listagem de administracao nao carrega mensagem nenhuma', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      await app.inject({
        method: 'POST', url: `/api/channels/${c.privado}/messages`,
        headers: { cookie: c.cookieDono }, payload: { content: 'segredo de estado' },
      })

      const gestao = await app.inject({
        method: 'GET', url: `/api/groups/${c.groupId}/channels/manage`,
        headers: { cookie: c.cookieAdmin },
      })
      // Nome sim, conteudo nunca - nem de relance, nem por contagem.
      expect(JSON.stringify(gestao.json())).not.toContain('segredo de estado')
      await app.close()
    })
  })
})
