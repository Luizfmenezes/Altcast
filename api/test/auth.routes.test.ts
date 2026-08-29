import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'

describe('rotas de autenticacao', () => {
  it('faz login e devolve cookie httpOnly', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'senha-longa-boa' },
      })
      expect(res.statusCode).toBe(200)
      const cookie = res.headers['set-cookie'] as string
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      await app.close()
    })
  })

  it('devolve a mesma mensagem para e-mail inexistente e senha errada', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const a = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'errada-mas-longa' } })
      const b = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'naoexiste@x.com', password: 'errada-mas-longa' } })
      expect(a.statusCode).toBe(401)
      expect(b.statusCode).toBe(401)
      expect(a.json().error.code).toBe(b.json().error.code)
      expect(a.json().error.message).toBe(b.json().error.message)
      await app.close()
    })
  })

  it('login e case-insensitive no e-mail', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'Felipe@X.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const res = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'felipe@x.com', password: 'senha-longa-boa' } })
      expect(res.statusCode).toBe(200)
      await app.close()
    })
  })

  it('me devolve 401 sem cookie e o usuario com cookie', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()

      const semCookie = await app.inject({ method: 'GET', url: '/api/auth/me' })
      expect(semCookie.statusCode).toBe(401)
      expect(semCookie.json().error.code).toBe('unauthenticated')

      const login = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'senha-longa-boa' } })
      const cookie = (login.headers['set-cookie'] as string).split(';')[0]!

      const comCookie = await app.inject({ method: 'GET', url: '/api/auth/me',
        headers: { cookie } })
      expect(comCookie.statusCode).toBe(200)
      expect(comCookie.json().user.email).toBe('f@x.com')
      expect(comCookie.json().groups).toEqual([])
      await app.close()
    })
  })

  it('logout revoga a sessao imediatamente', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const login = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'f@x.com', password: 'senha-longa-boa' } })
      const cookie = (login.headers['set-cookie'] as string).split(';')[0]!

      const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
      expect(out.statusCode).toBe(200)

      const depois = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
      expect(depois.statusCode).toBe(401)
      await app.close()
    })
  })

  it('recusa escrita com Origin nao permitida', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: 'senha-longa-boa' })
      const app = await buildServer()
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login',
        headers: { origin: 'https://site-malicioso.example' },
        payload: { email: 'f@x.com', password: 'senha-longa-boa' },
      })
      expect(res.statusCode).toBe(403)
      await app.close()
    })
  })
})
