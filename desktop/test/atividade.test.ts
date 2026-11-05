import { describe, it, expect } from 'vitest'
import { montarAtividade } from '../src/atividade'

const ORIGEM = 'https://altcast.exemplo'
const ID = '123456789012345678'
const U1 = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const U2 = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'
const LINK = `${ORIGEM}/assistir/${U1}/${U2}`

function pedido(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: ID, estado: 'transmitindo', grupo: 'Time', desde: 1_000, linkParaAssistir: LINK,
    ...extra,
  }
}

describe('o cartao do Discord, montado no processo principal', () => {
  it('transmitindo: texto, grupo, tempo e o botao de assistir', () => {
    const m = montarAtividade(pedido(), ORIGEM, 5_000)
    expect(m?.clientId).toBe(ID)
    expect(m?.atividade).toMatchObject({
      type: 0,
      details: 'Transmitindo a tela',
      state: 'Time',
      timestamps: { start: 1_000 },
      assets: { large_image: `${ORIGEM}/android-chrome-512x512.png` },
      buttons: [{ label: 'Assistir no Altcast', url: LINK }],
    })
  })

  it('em chamada sem tela nao tem botao, mesmo que a pagina mande link', () => {
    const m = montarAtividade(pedido({ estado: 'chamada' }), ORIGEM)
    expect(m?.atividade.details).toBe('Em chamada')
    expect(m?.atividade.buttons).toBeUndefined()
  })

  /**
   * A razao de o cartao ser montado aqui: a pagina e conteudo remoto, e nao
   * pode anunciar no perfil de ninguem um link que nao seja o do Altcast.
   */
  it.each([
    ['outra origem', `https://golpe.exemplo/assistir/${U1}/${U2}`],
    ['outro caminho do Altcast', `${ORIGEM}/convite/ABC`],
    ['com busca', `${LINK}?x=1`],
    ['esquema estranho', 'javascript:alert(1)'],
    ['nao e texto', 42],
  ])('link recusado (%s): o cartao sai sem botao', (_caso, link) => {
    const m = montarAtividade(pedido({ linkParaAssistir: link }), ORIGEM)
    expect(m).not.toBeNull()
    expect(m?.atividade.buttons).toBeUndefined()
  })

  it.each([
    ['Client ID que nao e snowflake', { clientId: 'abc' }],
    ['estado desconhecido', { estado: 'jogando' }],
    ['inicio invalido', { desde: Number.NaN }],
  ])('pedido torto nao vira cartao (%s)', (_caso, extra) => {
    expect(montarAtividade(pedido(extra), ORIGEM)).toBeNull()
  })

  it('nem objeto e', () => {
    expect(montarAtividade(null, ORIGEM)).toBeNull()
    expect(montarAtividade('x', ORIGEM)).toBeNull()
  })

  /** O Discord recusa o cartao INTEIRO com `state` de 1 caractere ou acima de 128. */
  it('grupo curto demais some; longo demais e cortado', () => {
    expect(montarAtividade(pedido({ grupo: 'A' }), ORIGEM)?.atividade.state).toBeUndefined()
    expect(montarAtividade(pedido({ grupo: null }), ORIGEM)?.atividade.state).toBeUndefined()
    const longo = montarAtividade(pedido({ grupo: 'x'.repeat(300) }), ORIGEM)?.atividade.state
    expect([...(longo ?? '')]).toHaveLength(128)
  })

  it('relogio adiantado nao produz tempo negativo', () => {
    const m = montarAtividade(pedido({ desde: 9_999 }), ORIGEM, 5_000)
    expect(m?.atividade.timestamps.start).toBe(5_000)
  })
})
