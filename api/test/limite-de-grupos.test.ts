import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { count, eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'
import { groups, users } from '../src/db/schema.js'
import { MAXIMO_DE_GRUPOS_POR_PESSOA } from '../src/groups/limite.js'

/**
 * O teto de grupos criados.
 *
 * Com cadastro aberto, criar grupo e a acao que uma conta em massa usaria para
 * fabricar lixo. A confirmacao de e-mail ja barra a conta descartavel; isto
 * barra a conta real que resolve criar duzentos grupos.
 *
 * O teto conta so o que a pessoa e DONA. Entrar em grupo por convite continua
 * ilimitado, e o caso mais abaixo prova que receber a titularidade de um grupo
 * pode legitimamente empurrar alguem acima do teto.
 */

/**
 * Entra e promove a administradora da plataforma.
 *
 * `loginComo` sempre CRIA o usuario, entao nao da para cria-lo antes com o
 * campo ligado — seria colisao de e-mail. Ligar o campo depois e o caminho que
 * o CLI de producao tambem percorre.
 */
async function promover(
  app: FastifyInstance, db: Database, email: string,
): Promise<{ cookie: string; userId: string }> {
  const eu = await loginComo(app, db, email)
  await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, eu.userId))
  return eu
}

async function criarGrupo(
  app: FastifyInstance, cookie: string, name: string,
): Promise<{ status: number; codigo?: string }> {
  const r = await app.inject({
    method: 'POST', url: '/api/groups', headers: { cookie }, payload: { name },
  })
  return r.statusCode === 201
    ? { status: r.statusCode }
    : { status: r.statusCode, codigo: r.json().error?.code as string }
}

describe('teto de grupos criados', () => {
  it('o quarto grupo e recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'pessoa@x.com')

      for (let i = 0; i < MAXIMO_DE_GRUPOS_POR_PESSOA; i++) {
        expect((await criarGrupo(app, eu.cookie, `Grupo ${i}`)).status).toBe(201)
      }

      expect(await criarGrupo(app, eu.cookie, 'Demais')).toEqual({
        status: 409, codigo: 'group_limit_reached',
      })
      await app.close()
    })
  })

  it('o administrador da plataforma nao tem teto', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await promover(app, db, 'chefe@x.com')

      for (let i = 0; i < MAXIMO_DE_GRUPOS_POR_PESSOA + 2; i++) {
        expect((await criarGrupo(app, eu.cookie, `Grupo ${i}`)).status).toBe(201)
      }
      await app.close()
    })
  })

  /**
   * O caso que prova o `FOR UPDATE`, e o unico que nao passaria sem ele.
   *
   * Sem lock, dois pedidos simultaneos leem "2" os dois, concluem que cabe, e
   * a pessoa termina com quatro grupos. Para ver este teste vermelho, tire o
   * `.for('update')` de `assertPodeCriarGrupo`.
   */
  it('dois pedidos ao mesmo tempo nao furam o teto', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'apressada@x.com')

      await criarGrupo(app, eu.cookie, 'Um')
      await criarGrupo(app, eu.cookie, 'Dois')

      const [a, b] = await Promise.all([
        criarGrupo(app, eu.cookie, 'Tres'),
        criarGrupo(app, eu.cookie, 'Quatro'),
      ])

      const status = [a.status, b.status].sort()
      expect(status).toEqual([201, 409])

      const [c] = await db.select({ n: count() })
        .from(groups).where(eq(groups.ownerId, eu.userId))
      expect(c?.n).toBe(MAXIMO_DE_GRUPOS_POR_PESSOA)
      await app.close()
    })
  })

  it('apagar um grupo devolve a vaga', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'reciclando@x.com')

      const ids: string[] = []
      for (let i = 0; i < MAXIMO_DE_GRUPOS_POR_PESSOA; i++) {
        const r = await app.inject({
          method: 'POST', url: '/api/groups',
          headers: { cookie: eu.cookie }, payload: { name: `Grupo ${i}` },
        })
        ids.push(r.json().id as string)
      }
      expect((await criarGrupo(app, eu.cookie, 'Demais')).status).toBe(409)

      await app.inject({
        method: 'DELETE', url: `/api/groups/${ids[0]}`, headers: { cookie: eu.cookie },
      })

      expect((await criarGrupo(app, eu.cookie, 'Agora cabe')).status).toBe(201)
      await app.close()
    })
  })

  /**
   * Receber a titularidade PODE passar do teto, e isso e deliberado.
   *
   * Recusar a transferencia prenderia o grupo no dono que quer sair, ja que
   * `owner_cannot_leave` faz da transferencia a unica saida dele. Quem fica
   * acima do teto apenas nao cria grupos NOVOS.
   */
  it('receber a titularidade pode passar do teto, e nao e recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const cheia = await loginComo(app, db, 'cheia@x.com')
      const doadora = await loginComo(app, db, 'doadora@x.com')

      for (let i = 0; i < MAXIMO_DE_GRUPOS_POR_PESSOA; i++) {
        await criarGrupo(app, cheia.cookie, `Grupo ${i}`)
      }

      const r = await app.inject({
        method: 'POST', url: '/api/groups',
        headers: { cookie: doadora.cookie }, payload: { name: 'Doado' },
      })
      const doado = r.json().id as string

      const conv = await app.inject({
        method: 'POST', url: `/api/groups/${doado}/invites`,
        headers: { cookie: doadora.cookie }, payload: {},
      })
      await app.inject({
        method: 'POST', url: `/api/invites/${conv.json().code}/accept`,
        headers: { cookie: cheia.cookie },
      })

      const transferencia = await app.inject({
        method: 'PATCH', url: `/api/groups/${doado}/members/${cheia.userId}`,
        headers: { cookie: doadora.cookie }, payload: { role: 'owner' },
      })

      expect(transferencia.statusCode).toBe(200)

      // E agora ela esta acima do teto — e nao cria mais nenhum.
      expect((await criarGrupo(app, cheia.cookie, 'Mais um')).status).toBe(409)
      await app.close()
    })
  })

  it('a cota aparece em GET /api/auth/me', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'contando@x.com')
      await criarGrupo(app, eu.cookie, 'Um')
      await criarGrupo(app, eu.cookie, 'Dois')

      const r = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: eu.cookie },
      })
      expect(r.json().groupQuota).toEqual({ used: 2, max: MAXIMO_DE_GRUPOS_POR_PESSOA })

      const chefe = await promover(app, db, 'sem-teto@x.com')
      const r2 = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: chefe.cookie },
      })
      // `null` diz "sem teto", e nao "teto zero".
      expect(r2.json().groupQuota).toEqual({ used: 0, max: null })
      await app.close()
    })
  })
})
