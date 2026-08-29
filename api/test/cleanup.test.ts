import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario, loginComo } from './helpers/fixtures.js'
import { sessions } from '../src/db/schema.js'
import { limparSessoesExpiradas } from '../src/cli/cleanup.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'

/** Sessao com vencimento arbitrario, para nao depender de esperar o relogio. */
async function semear(db: Database, userId: string, vencimento: Date): Promise<void> {
  await db.insert(sessions).values({ id: newId(), userId, expiresAt: vencimento })
}

const ONTEM = new Date(Date.now() - 86_400_000)
const DAQUI_A_UM_MES = new Date(Date.now() + 30 * 86_400_000)

describe('limpeza de sessoes', () => {
  it('remove as expiradas e preserva as validas', async () => {
    await withTestDb(async db => {
      const userId = await criarUsuario(db, { email: 'alguem@x.com' })
      for (let i = 0; i < 3; i++) await semear(db, userId, ONTEM)
      for (let i = 0; i < 2; i++) await semear(db, userId, DAQUI_A_UM_MES)

      expect(await limparSessoesExpiradas()).toBe(3)

      const restantes = await db.select().from(sessions).where(eq(sessions.userId, userId))
      expect(restantes).toHaveLength(2)
      expect(restantes.every(s => s.expiresAt > new Date())).toBe(true)
    })
  })

  it('e idempotente: rodar de novo nao remove nada a mais', async () => {
    await withTestDb(async db => {
      const userId = await criarUsuario(db, { email: 'alguem@x.com' })
      await semear(db, userId, ONTEM)
      await semear(db, userId, DAQUI_A_UM_MES)

      expect(await limparSessoesExpiradas()).toBe(1)
      expect(await limparSessoesExpiradas()).toBe(0)
      expect(await db.select().from(sessions)).toHaveLength(1)
    })
  })

  it('banco sem nada a limpar devolve zero, sem reclamar', async () => {
    await withTestDb(async () => {
      expect(await limparSessoesExpiradas()).toBe(0)
    })
  })

  it('a sessao preservada continua autenticando de verdade', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const { cookie, userId } = await loginComo(app, db, 'viva@x.com')
      await semear(db, userId, ONTEM)

      expect(await limparSessoesExpiradas()).toBe(1)

      // A prova que importa nao e a contagem de linhas: e a pessoa continuar
      // dentro depois da faxina.
      const res = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie },
      })
      expect(res.statusCode).toBe(200)
      await app.close()
    })
  })
})
