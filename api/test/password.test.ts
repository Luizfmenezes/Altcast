import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, assertPasswordAcceptable, DUMMY_HASH } from '../src/auth/password.js'

describe('password', () => {
  it('gera hash argon2id e verifica', async () => {
    const h = await hashPassword('senha-bem-longa-123')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(h, 'senha-bem-longa-123')).toBe(true)
    expect(await verifyPassword(h, 'errada')).toBe(false)
  })

  it('recusa senha curta', () => {
    expect(() => assertPasswordAcceptable('curta')).toThrow()
  })

  it('recusa senha vazada conhecida', () => {
    // 'qwertyuiop' tem 10 caracteres, entao passa pela regra de comprimento.
    // O teste so falha se a lista de vazadas nao for consultada.
    expect(() => assertPasswordAcceptable('qwertyuiop')).toThrow()
  })

  it('devolve false para hash malformado, sem lancar', async () => {
    // O catch existe porque um hash corrompido no banco nao pode derrubar o
    // login com 500 — tem que ser apenas credencial invalida.
    expect(await verifyPassword('nao-e-um-hash', 'qualquer-senha')).toBe(false)
  })

  it('DUMMY_HASH e verificavel e sempre falso', async () => {
    expect(await verifyPassword(DUMMY_HASH, 'qualquer-coisa-aqui')).toBe(false)
  })

  it('DUMMY_HASH custa o mesmo que um hash real (tempo uniforme no login)', async () => {
    const real = await hashPassword('outra-senha-longa')
    const medir = async (h: string) => {
      const t = process.hrtime.bigint()
      await verifyPassword(h, 'tentativa-qualquer')
      return Number(process.hrtime.bigint() - t) / 1e6
    }
    await medir(real)
    const tReal = await medir(real)
    const tDummy = await medir(DUMMY_HASH)
    // Se DUMMY_HASH fosse invalido, verify falharia a parsear em microssegundos
    // e a diferenca de tempo entregaria quem tem conta.
    expect(tDummy).toBeGreaterThan(tReal * 0.5)
  })
})
