import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  VISTA_INICIAL, ZOOM_MAXIMO, alternarDuplo, aproximarEm, arrastar, limitar,
} from '../src/features/voice/zoom.js'
import { FaixaDeMidia } from '../src/features/voice/FaixaDeMidia.js'
import type { Faixa } from '../src/lib/midia.js'

/** Uma janela de 400x200: o tamanho exato nao importa, so que seja fixo. */
const W = 400
const H = 200

describe('zoom da transmissao — a conta', () => {
  it('o ponto sob o cursor continua sob o cursor depois de aproximar', () => {
    const v = aproximarEm(VISTA_INICIAL, 2, 100, 50, W, H)
    expect(v.s).toBe(2)
    // O pixel de conteudo que estava em (100, 50) agora e desenhado em
    // x + 100 * s — e precisa cair de novo em 100.
    expect(v.x + 100 * v.s).toBeCloseTo(100)
    expect(v.y + 50 * v.s).toBeCloseTo(50)
  })

  it('nunca afasta alem do inteiro, nem aproxima alem do teto', () => {
    expect(aproximarEm(VISTA_INICIAL, 0.2, 0, 0, W, H)).toEqual(VISTA_INICIAL)
    expect(aproximarEm(VISTA_INICIAL, 100, 0, 0, W, H).s).toBe(ZOOM_MAXIMO)
  })

  it('arrastar nao deixa aparecer borda vazia', () => {
    const perto = aproximarEm(VISTA_INICIAL, 2, 0, 0, W, H)
    expect(arrastar(perto, 500, 500, W, H)).toMatchObject({ x: 0, y: 0 })
    expect(arrastar(perto, -5000, -5000, W, H)).toMatchObject({ x: W - W * 2, y: H - H * 2 })
  })

  it('sem zoom nao ha o que arrastar', () => {
    expect(arrastar(VISTA_INICIAL, 30, 30, W, H)).toEqual(VISTA_INICIAL)
    expect(limitar({ s: 1, x: -10, y: 10 }, W, H)).toEqual(VISTA_INICIAL)
  })

  it('duplo clique aproxima, e o segundo volta ao inteiro', () => {
    const perto = alternarDuplo(VISTA_INICIAL, 200, 100, W, H)
    expect(perto.s).toBe(2.5)
    expect(alternarDuplo(perto, 10, 10, W, H)).toEqual(VISTA_INICIAL)
  })
})

describe('zoom da transmissao — na faixa', () => {
  const tela = {
    userId: 'u2', papel: 'tela', local: false,
    track: { attach: vi.fn(), detach: vi.fn(), sid: 'TR_1' },
  } as unknown as Faixa

  it('os botoes aproximam, mostram a escala e voltam ao inteiro', async () => {
    const usuario = userEvent.setup()
    render(<FaixaDeMidia faixa={tela} rotulo="Ana" />)

    const afastar = screen.getByRole('button', { name: 'Afastar Ana — tela' })
    expect(afastar).toBeDisabled()

    await usuario.click(screen.getByRole('button', { name: 'Aproximar Ana — tela' }))
    const escala = screen.getByRole('button', { name: /Zoom de 150%/ })
    expect(afastar).toBeEnabled()

    await usuario.click(escala)
    expect(screen.queryByRole('button', { name: /Zoom de/ })).toBeNull()
  })

  it('miniatura nao tem zoom', () => {
    render(<FaixaDeMidia faixa={tela} rotulo="Ana" tamanho="miniatura" />)
    expect(screen.queryByRole('button', { name: /Aproximar/ })).toBeNull()
  })
})
