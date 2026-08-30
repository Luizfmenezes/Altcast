import { describe, it, expect } from 'vitest'
import { cn } from '../src/lib/utils.js'

describe('cn', () => {
  it('junta classes soltas', () => {
    expect(cn('flex', 'gap-2')).toBe('flex gap-2')
  })

  it('descarta o que e falso', () => {
    const oculto = false as boolean
    expect(cn('flex', oculto && 'oculto', undefined, null, '', 'gap-2')).toBe('flex gap-2')
  })

  it('aceita a forma condicional em objeto', () => {
    expect(cn('base', { ativo: true, inativo: false })).toBe('base ativo')
  })

  // O motivo de existir twMerge e este: sem ele as duas sobreviveriam e quem
  // vence passaria a depender da ordem em que o Tailwind emitiu as regras.
  it('desempata conflito do Tailwind pelo ultimo valor', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted')
  })

  it('nao confunde utilities de eixos diferentes', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4')
  })
})
