import { describe, it, expect } from 'vitest'
import { contrast } from './helpers/contrast.js'
import { LIGHT, DARK } from '../src/ui/tokens.js'

/**
 * Contraste validado no token, nao no olho. Sem este teste, uma cor "so um
 * pouco mais clara" entra num ajuste futuro e quebra a conformidade sem que
 * ninguem perceba ate alguem reclamar.
 */
const PARES: Array<[keyof typeof LIGHT, keyof typeof LIGHT, number]> = [
  ['fg', 'bg', 4.5],
  ['fgMuted', 'bg', 4.5],
  ['fg', 'bgRaised', 4.5],
  ['fgMuted', 'bgRaised', 4.5],
  ['accentFg', 'accent', 4.5],
  ['border', 'bg', 3],
  ['focusRing', 'bg', 3],
  ['danger', 'bg', 4.5],
  ['presenceOnline', 'bg', 3],
  // bgHover e fundo de item selecionado e sob o cursor - o canal ativo escreve
  // o acento EM CIMA dele. Faltar este par aqui foi o que deixou passar uma
  // reprovacao real de contraste ate a varredura axe encontra-la no navegador.
  ['fg', 'bgHover', 4.5],
  ['fgMuted', 'bgHover', 4.5],
  ['accent', 'bgHover', 4.5],
  ['danger', 'bgHover', 4.5],
  ['border', 'bgHover', 3],
  ['presenceOnline', 'bgHover', 3],
]

describe('contraste WCAG 2.2 AA', () => {
  for (const [a, b, min] of PARES) {
    it(`${a} sobre ${b} no tema claro atinge ${min}:1`, () => {
      expect(contrast(LIGHT[a], LIGHT[b])).toBeGreaterThanOrEqual(min)
    })
    it(`${a} sobre ${b} no tema escuro atinge ${min}:1`, () => {
      expect(contrast(DARK[a], DARK[b])).toBeGreaterThanOrEqual(min)
    })
  }

  it('os dois temas definem exatamente as mesmas chaves', () => {
    // Um token so no escuro viraria cor indefinida no claro — e o navegador
    // resolveria como transparente, sem erro nenhum.
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort())
  })
})
