import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, criarUsuario, loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'

/**
 * Os contadores vivem em memoria do processo e sao globais ao servidor, entao
 * cada teste sobe o proprio `buildServer()` — reaproveitar um deixaria o
 * segundo teste comecando com a cota do primeiro ja gasta.
 */
describe('limites de taxa', () => {
  it('bloqueia a sexta tentativa de login em um minuto', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      await criarUsuario(db, { email: 'alvo@x.com', senha: 'senha-longa-boa' })

      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/auth/login',
          payload: { email: 'alvo@x.com', password: 'errada-de-proposito' },
        })
        expect(res.statusCode).toBe(401)
      }

      const sexta = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'alvo@x.com', password: 'errada-de-proposito' },
      })
      expect(sexta.statusCode).toBe(429)
      expect(sexta.json().error.code).toBe('rate_limited')
      // O cliente precisa saber quando voltar; sem isto ele adivinha e insiste.
      expect(sexta.headers['retry-after']).toBeDefined()
      await app.close()
    })
  })

  it('limita mensagens a 30 por minuto por usuario', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const canais = await app.inject({
        method: 'GET', url: `/api/groups/${base.groupId}/channels`,
        headers: { cookie: base.cookieDono },
      })
      const canalId = canais.json()[0].id as string

      for (let i = 0; i < 30; i++) {
        const res = await app.inject({
          method: 'POST', url: `/api/channels/${canalId}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: `msg ${i}` },
        })
        expect(res.statusCode).toBe(201)
      }

      const excedente = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: 'a mais' },
      })
      expect(excedente.statusCode).toBe(429)

      // O limite e por usuario: o admin comeca com a cota inteira.
      const outro = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieAdmin }, payload: { content: 'minha vez' },
      })
      expect(outro.statusCode).toBe(201)
      await app.close()
    })
  })

  it('limita aceitacao de convite a 5 por hora', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const convite = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/invites`,
        headers: { cookie: base.cookieDono }, payload: {},
      })
      const code = convite.json().code as string

      // Convites ja usados devolvem already_member; o que importa aqui e a
      // contagem de TENTATIVAS, que e o que trava a varredura de codigos.
      const entrando = await loginComo(app, db, 'insistente@x.com')
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST', url: `/api/invites/${code}/accept`,
          headers: { cookie: entrando.cookie },
        })
        expect(res.statusCode).not.toBe(429)
      }

      const sexta = await app.inject({
        method: 'POST', url: `/api/invites/${code}/accept`,
        headers: { cookie: entrando.cookie },
      })
      expect(sexta.statusCode).toBe(429)
      await app.close()
    })
  })

  /**
   * A criacao de conta nao tem teto proprio.
   *
   * O limite anterior era de tres por hora por IP, e ele nao distinguia um
   * ataque de um escritorio inteiro atras do mesmo NAT: bastavam tres pessoas
   * entrando no mesmo convite para a quarta bater em 429 e nao ter o que fazer
   * pela hora seguinte. Sobra o teto geral da aplicacao, que nenhum cadastro
   * de gente real alcanca.
   */
  it('cadastro nao trava depois de tres contas na mesma hora', async () => {
    await withTestDb(async (db) => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const convite = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/invites`,
        headers: { cookie: base.cookieDono }, payload: { maxUses: 20 },
      })
      const code = convite.json().code as string

      for (let i = 0; i < 6; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/auth/register',
          payload: {
            email: `pessoa${String(i)}@x.com`,
            inviteCode: code,
            password: 'senha-longa-boa',
            displayName: `Pessoa ${String(i)}`,
          },
        })
        expect(res.statusCode).toBe(201)
      }
      await app.close()
    })
  })

  it('rotas normais aceitam bem mais que as limitadas', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      for (let i = 0; i < 60; i++) {
        const res = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}`,
          headers: { cookie: base.cookieDono },
        })
        expect(res.statusCode).toBe(200)
      }
      await app.close()
    })
  })
})
