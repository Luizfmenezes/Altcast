import { describe, it, expect, beforeEach } from 'vitest'
import { calls } from '../src/realtime/calls.js'

describe('registro de chamadas', () => {
  beforeEach(() => calls.clear())

  it('entrar anuncia uma vez; a segunda aba nao anuncia de novo', () => {
    expect(calls.join('c1', 'u1')).toBe(true)
    expect(calls.join('c1', 'u1')).toBe(false)
    expect(calls.participantes('c1')).toHaveLength(1)
  })

  it('entra mudo: transmitir e sempre um ato deliberado', () => {
    calls.join('c1', 'u1')
    expect(calls.participantes('c1')[0]).toEqual({
      userId: 'u1', microfone: false, camera: false, tela: false,
    })
  })

  it('sair devolve true so para quem estava na sala', () => {
    calls.join('c1', 'u1')
    expect(calls.leave('c1', 'u1')).toBe(true)
    expect(calls.leave('c1', 'u1')).toBe(false)
    expect(calls.leave('canal-que-nunca-existiu', 'u1')).toBe(false)
  })

  it('atualizar so vale para quem esta dentro', () => {
    calls.join('c1', 'u1')
    expect(calls.atualizar('c1', 'u1', { microfone: true }))
      .toEqual({ userId: 'u1', microfone: true, camera: false, tela: false })
    expect(calls.atualizar('c1', 'u2', { microfone: true })).toBeNull()
    expect(calls.atualizar('c2', 'u1', { microfone: true })).toBeNull()
  })

  it('a atualizacao e parcial: ligar a camera nao desliga o microfone', () => {
    calls.join('c1', 'u1')
    calls.atualizar('c1', 'u1', { microfone: true })
    expect(calls.atualizar('c1', 'u1', { camera: true })).toEqual({
      userId: 'u1', microfone: true, camera: true, tela: false,
    })
  })

  it('sabe em quais canais a pessoa esta, que e o que a queda do socket precisa', () => {
    calls.join('c1', 'u1')
    calls.join('c2', 'u1')
    calls.join('c2', 'u2')
    expect(calls.canaisDe('u1').sort()).toEqual(['c1', 'c2'])
    expect(calls.canaisDe('u2')).toEqual(['c2'])
    expect(calls.canaisDe('u3')).toEqual([])
  })

  it('sala vazia nao fica ocupando memoria', () => {
    calls.join('c1', 'u1')
    calls.leave('c1', 'u1')
    expect(calls.participantes('c1')).toEqual([])
    expect(calls.canaisDe('u1')).toEqual([])
  })
})
