import { describe, it, expect } from 'vitest'
import { contrast } from './helpers/contrast.js'
import { CORES_DE_AVATAR, corDe } from '../src/ui/Avatar.js'
import { LIGHT, DARK } from '../src/ui/tokens.js'

/**
 * Mesma disciplina da paleta: a cor do avatar e validada no valor, e nao no
 * olho. Sem isto, um tom "so um pouco mais vivo" entra num ajuste futuro e
 * apaga a inicial que ele deveria mostrar.
 */
describe('cores de avatar', () => {
  for (const cor of CORES_DE_AVATAR) {
    it(`${cor} sustenta a inicial branca a 4.5:1`, () => {
      expect(contrast('#ffffff', cor)).toBeGreaterThanOrEqual(4.5)
    })
  }

  // Nesta paleta o vermelho significa erro e o azul do acento significa
  // selecionado. Um avatar que caia em qualquer um dos dois passa a dizer
  // sobre a pessoa algo que o sistema reservou para outra coisa.
  const distancia = (a: string, b: string): number => {
    const canais = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const [x, y] = [canais(a), canais(b)]
    return Math.hypot(...x.map((v, i) => v - (y[i] ?? 0)))
  }

  for (const [nome, reservada] of [
    ['o vermelho de erro', LIGHT.danger],
    ['o azul do acento claro', LIGHT.accent],
    ['o azul do acento escuro', DARK.accent],
  ] as const) {
    it(`nenhuma se confunde com ${nome}`, () => {
      for (const cor of CORES_DE_AVATAR) {
        expect(distancia(cor, reservada)).toBeGreaterThan(60)
      }
    })
  }

  it('a mesma pessoa recebe sempre a mesma cor', () => {
    expect(corDe('Ana Paula')).toBe(corDe('Ana Paula'))
  })

  it('pessoas diferentes se espalham pela paleta', () => {
    const nomes = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio', 'Gabi', 'Hugo']
    expect(new Set(nomes.map(corDe)).size).toBeGreaterThanOrEqual(5)
  })
})
