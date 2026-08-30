import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario, loginComo } from './helpers/fixtures.js'
import { attachments, sessions } from '../src/db/schema.js'
import { limparAnexosOrfaos, limparSessoesExpiradas } from '../src/cli/cleanup.js'
import { cenarioComAdmin } from './helpers/fixtures.js'
import type { Armazem } from '../src/media/armazenamento.js'
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


/** Conta o que a faxina mandou apagar, sem precisar de um MinIO de pe. */
function armazemQueConta(): Armazem & { removidos: string[] } {
  const removidos: string[] = []
  return {
    removidos,
    guardar: async () => undefined,
    ler: async () => { throw new Error('nao usado') },
    remover: async chaves => { removidos.push(...chaves) },
  }
}

/**
 * O upload acontece ANTES do envio da mensagem — e o que da progresso e previa
 * — entao desistir de mandar deixa bytes pagos e sem dono. Sem esta faxina eles
 * ficariam para sempre contando contra a cota de um canal, por um arquivo que
 * ninguem chegou a ver.
 */
describe('limpeza de anexos orfaos', () => {
  it('remove o orfao velho e preserva o recem-subido e o que virou mensagem', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const canais = await app.inject({
        method: 'GET', url: `/api/groups/${base.groupId}/channels`,
        headers: { cookie: base.cookieDono },
      })
      const channelId = canais.json()[0].id as string

      const msg = await app.inject({
        method: 'POST', url: `/api/channels/${channelId}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: 'com arquivo' },
      })
      const messageId = msg.json().id as string

      const velho = newId()
      const novo = newId()
      const preso = newId()
      await db.insert(attachments).values([
        {
          id: velho, channelId, objectKey: 'k/velho', filename: 'v.bin',
          contentType: 'application/octet-stream', byteSize: 10, thumbKey: 'k/velho-thumb',
          createdAt: new Date(Date.now() - 48 * 3_600_000),
        },
        {
          id: novo, channelId, objectKey: 'k/novo', filename: 'n.bin',
          contentType: 'application/octet-stream', byteSize: 10,
          createdAt: new Date(),
        },
        {
          id: preso, channelId, messageId, objectKey: 'k/preso', filename: 'p.bin',
          contentType: 'application/octet-stream', byteSize: 10,
          createdAt: new Date(Date.now() - 48 * 3_600_000),
        },
      ])

      const armazem = armazemQueConta()
      expect(await limparAnexosOrfaos(armazem)).toBe(1)

      const restantes = await db.select().from(attachments)
      expect(restantes.map(a => a.id).sort()).toEqual([novo, preso].sort())
      // A miniatura sai junto: deixa-la para tras seria meio arquivo orfao.
      expect(armazem.removidos.sort()).toEqual(['k/velho', 'k/velho-thumb'].sort())
      await app.close()
    })
  })

  it('sem orfao nenhum, nao toca no armazenamento', async () => {
    await withTestDb(async () => {
      const armazem = armazemQueConta()
      expect(await limparAnexosOrfaos(armazem)).toBe(0)
      expect(armazem.removidos).toEqual([])
    })
  })
})
