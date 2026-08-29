import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'

describe('metricas', () => {
  it('exige sessao valida', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const res = await app.inject({ method: 'GET', url: '/api/metrics' })
      // Contagem de conexoes e sinal de uso, e sinal de uso e informacao sobre
      // quem usa. A rota nao fica aberta.
      expect(res.statusCode).toBe(401)
      await app.close()
    })
  })

  it('responde as perguntas que aparecem de verdade na operacao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'operador@x.com')

      const res = await app.inject({ method: 'GET', url: '/api/metrics', headers: { cookie } })
      expect(res.statusCode).toBe(200)

      const m = res.json() as Record<string, number>
      expect(m['conexoesAtivas']).toBe(0)
      expect(m['usuariosOnline']).toBe(0)
      // A medida vem de um SELECT real: se o banco estiver lento, o numero diz.
      expect(m['latenciaDoBancoMs']).toBeGreaterThanOrEqual(0)
      expect(m['memoriaMb']).toBeGreaterThan(0)
      expect(m['uptimeSegundos']).toBeGreaterThanOrEqual(0)
      await app.close()
    })
  })

  it('nao vaza nada sobre quem esta conectado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie } = await loginComo(app, db, 'operador@x.com')

      const res = await app.inject({ method: 'GET', url: '/api/metrics', headers: { cookie } })
      // Numeros agregados, nunca identidades: a metrica diz quantos, e nao quem.
      expect(JSON.stringify(res.json())).not.toContain('operador@x.com')
      expect(Object.keys(res.json() as object).sort()).toEqual([
        'conexoesAtivas', 'latenciaDoBancoMs', 'memoriaMb', 'uptimeSegundos', 'usuariosOnline',
      ])
      await app.close()
    })
  })
})
