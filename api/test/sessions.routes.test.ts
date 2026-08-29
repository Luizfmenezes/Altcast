import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { sessions } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'

describe('sessoes ativas', () => {
  it('lista as proprias sessoes sem nunca devolver o token', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie, userId } = await loginComo(app, db, 'dono@x.com')

      const res = await app.inject({
        method: 'GET', url: '/api/auth/sessions',
        headers: { cookie, 'user-agent': 'Firefox/1.0' },
      })
      expect(res.statusCode).toBe(200)

      const lista = res.json() as { handle: string; current: boolean }[]
      expect(lista).toHaveLength(1)
      expect(lista[0]!.current).toBe(true)

      // O id da sessao E o token do cookie. Devolve-lo num JSON daria a
      // qualquer XSS a lista completa de credenciais vivas da conta.
      const [linha] = await db.select().from(sessions).where(eq(sessions.userId, userId))
      expect(JSON.stringify(lista)).not.toContain(linha!.id)
      await app.close()
    })
  })

  it('cada sessao mostra dispositivo e ultimo uso', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'dono@x.com')

      const res = await app.inject({
        method: 'GET', url: '/api/auth/sessions', headers: { cookie },
      })
      expect(res.json()[0]).toMatchObject({
        createdAt: expect.any(String), lastSeenAt: expect.any(String),
      })
      await app.close()
    })
  })

  it('nao mostra a sessao de outra pessoa', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      const res = await app.inject({
        method: 'GET', url: '/api/auth/sessions', headers: { cookie: base.cookieDono },
      })
      // Duas contas logaram neste servidor; cada uma ve exatamente a sua.
      expect(res.json()).toHaveLength(1)
      await app.close()
    })
  })

  it('revoga outra sessao pelo identificador publico', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const email = 'dono@x.com'
      const primeira = await loginComo(app, db, email)

      // Segundo login da mesma conta, como se fosse outro aparelho.
      const outra = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email, password: 'senha-longa-boa' },
        remoteAddress: '10.0.0.2',
      })
      const cookieOutra = (outra.headers['set-cookie'] as string).split(';')[0]!

      const lista = await app.inject({
        method: 'GET', url: '/api/auth/sessions', headers: { cookie: primeira.cookie },
      })
      const alheia = (lista.json() as { handle: string; current: boolean }[])
        .find(s => !s.current)!

      const apagada = await app.inject({
        method: 'DELETE', url: `/api/auth/sessions/${alheia.handle}`,
        headers: { cookie: primeira.cookie },
      })
      expect(apagada.statusCode).toBe(204)

      // Revogar e apagar a linha, e o efeito e imediato.
      const usandoARevogada = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOutra },
      })
      expect(usandoARevogada.statusCode).toBe(401)

      const aindaValida = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: primeira.cookie },
      })
      expect(aindaValida.statusCode).toBe(200)
      await app.close()
    })
  })

  it('nao revoga a sessao de outra conta, mesmo com o identificador certo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)

      const doAdmin = await app.inject({
        method: 'GET', url: '/api/auth/sessions', headers: { cookie: base.cookieAdmin },
      })
      const handleDoAdmin = (doAdmin.json() as { handle: string }[])[0]!.handle

      const tentativa = await app.inject({
        method: 'DELETE', url: `/api/auth/sessions/${handleDoAdmin}`,
        headers: { cookie: base.cookieDono },
      })
      expect(tentativa.statusCode).toBe(404)

      const admin = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: base.cookieAdmin },
      })
      expect(admin.statusCode).toBe(200)
      await app.close()
    })
  })

  it('identificador inexistente devolve 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'dono@x.com')

      const res = await app.inject({
        method: 'DELETE', url: '/api/auth/sessions/naoexiste', headers: { cookie },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  it('exige autenticacao', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const res = await app.inject({ method: 'GET', url: '/api/auth/sessions' })
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })
})
