import { describe, it, expect } from 'vitest'
import { generateInviteCode, normalizeInviteCode } from '../src/invites/code.js'

const ALFABETO = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

describe('codigo de convite', () => {
  it('tem 8 caracteres do alfabeto Crockford', () => {
    for (let i = 0; i < 200; i++) expect(generateInviteCode()).toMatch(ALFABETO)
  })

  it('nunca contem letras ambiguas', () => {
    const amostra = Array.from({ length: 500 }, generateInviteCode).join('')
    for (const c of ['I', 'L', 'O', 'U']) expect(amostra).not.toContain(c)
  })

  it('normaliza o que a pessoa digita errado', () => {
    expect(normalizeInviteCode('k7m2p9xq')).toBe('K7M2P9XQ')
    expect(normalizeInviteCode('KIM2P9XQ')).toBe('K1M2P9XQ')  // I vira 1
    expect(normalizeInviteCode('KLM2P9XQ')).toBe('K1M2P9XQ')  // L vira 1
    expect(normalizeInviteCode('KOM2P9XQ')).toBe('K0M2P9XQ')  // O vira 0
    expect(normalizeInviteCode(' k7m2-p9xq ')).toBe('K7M2P9XQ')
  })

  it('gera codigos distintos', () => {
    const s = new Set(Array.from({ length: 2000 }, generateInviteCode))
    expect(s.size).toBe(2000)
  })
})
