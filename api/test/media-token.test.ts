import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { assinarTokenDeMidia, VALIDADE_DO_TOKEN_S } from '../src/media/token.js'

const CHAVE = 'chave-de-teste'
const SEGREDO = 'segredo-de-teste-com-32-bytes-ou-mais'
const AGORA = 1_800_000_000_000

const base = {
  sala: 'c1', usuario: 'u1', nomeExibido: 'Ana',
  podePublicar: true, moderador: false,
}

/**
 * O corpo que o token carrega. Descrito por extenso, e nao como
 * `Record<string, unknown>`, porque e exatamente este formato que o LiveKit
 * espera: um campo com o nome errado passaria no teste e falharia no SFU.
 */
type CorpoDoToken = {
  iss: string
  sub: string
  name: string
  nbf: number
  exp: number
  video: {
    room: string
    roomJoin: boolean
    canSubscribe: boolean
    canPublish: boolean
    canPublishData: boolean
    roomAdmin: boolean
  }
}

function corpoDe(token: string): CorpoDoToken {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as CorpoDoToken
}

describe('token de midia', () => {
  it('assina com HS256 e o segredo, verificavel byte a byte', () => {
    const token = assinarTokenDeMidia(base, CHAVE, SEGREDO, AGORA)
    const [cabecalho, corpo, assinatura] = token.split('.')

    expect(JSON.parse(Buffer.from(cabecalho!, 'base64url').toString()))
      .toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url'))
      .toBe(assinatura)
  })

  it('vale por cinco minutos, nao mais', () => {
    const c = corpoDe(assinarTokenDeMidia(base, CHAVE, SEGREDO, AGORA))
    expect(c.exp - c.nbf).toBe(VALIDADE_DO_TOKEN_S)
    expect(VALIDADE_DO_TOKEN_S).toBe(300)
  })

  it('a sala e o canal, e a identidade e o usuario', () => {
    const c = corpoDe(assinarTokenDeMidia({ ...base, sala: 'canal-x', usuario: 'ana' },
      CHAVE, SEGREDO, AGORA))
    expect(c.video.room).toBe('canal-x')
    expect(c.sub).toBe('ana')
    expect(c.iss).toBe(CHAVE)
  })

  it('quem nao pode publicar entra mudo, mas ouve', () => {
    const c = corpoDe(assinarTokenDeMidia({ ...base, podePublicar: false },
      CHAVE, SEGREDO, AGORA))
    expect(c.video.canPublish).toBe(false)
    expect(c.video.canSubscribe).toBe(true)
    expect(c.video.roomJoin).toBe(true)
  })

  it('moderar e privilegio declarado, nunca o padrao', () => {
    expect(corpoDe(assinarTokenDeMidia(base, CHAVE, SEGREDO, AGORA)).video.roomAdmin)
      .toBe(false)
    const comModerador = assinarTokenDeMidia(
      { ...base, moderador: true }, CHAVE, SEGREDO, AGORA,
    )
    expect(corpoDe(comModerador).video.roomAdmin).toBe(true)
  })

  it('nao abre canal de dados: o tempo real passa pelo WebSocket da API', () => {
    expect(corpoDe(assinarTokenDeMidia(base, CHAVE, SEGREDO, AGORA)).video.canPublishData)
      .toBe(false)
  })

  it('segredo diferente produz assinatura diferente', () => {
    const a = assinarTokenDeMidia(base, CHAVE, SEGREDO, AGORA)
    const b = assinarTokenDeMidia(base, CHAVE, `${SEGREDO}-outro`, AGORA)
    expect(a).not.toBe(b)
  })
})

describe('configuracao de midia', () => {
  it('as tres variaveis produzem configuracao', async () => {
    const { configuracaoDeMidia } = await import('../src/media/token.js')
    expect(configuracaoDeMidia({ chave: 'k', segredo: 's', url: 'ws://x' }))
      .toEqual({ chave: 'k', segredo: 's', url: 'ws://x' })
  })

  it('meia configuracao e nenhuma: null, para virar 503 honesto', async () => {
    const { configuracaoDeMidia } = await import('../src/media/token.js')
    expect(configuracaoDeMidia({ chave: 'k', segredo: 's' })).toBeNull()
    expect(configuracaoDeMidia({ chave: 'k', url: 'ws://x' })).toBeNull()
    expect(configuracaoDeMidia({ segredo: 's', url: 'ws://x' })).toBeNull()
    expect(configuracaoDeMidia({})).toBeNull()
    expect(configuracaoDeMidia({ chave: '', segredo: 's', url: 'ws://x' })).toBeNull()
  })
})
