import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../src/AppShell.js'
import { useStore } from '../src/lib/store.js'
import {
  CANAIS_MAX, CANAIS_MIN, LAYOUT_PADRAO, lerLayout, pctDe, pxDe,
} from '../src/lib/layout.js'
import type { Ready } from '../src/lib/tipos.js'

/**
 * Colunas negociaveis.
 *
 * O que se prova aqui NAO e a largura em pixel — o jsdom nao faz layout, e
 * medir nele seria medir nada. O que se prova e o contrato: a divisoria existe
 * como separador operavel por teclado, recolher tira a navegacao da ARVORE e
 * nao so da vista, e a escolha sobrevive a um remontar.
 *
 * A largura de verdade, contra um navegador de verdade, e o Playwright que
 * verifica.
 */

const GRUPO = 'g1'
const CANAL = 'c1'

/**
 * O jsdom nao implementa `matchMedia`, e sem ele o shell nasce SEMPRE em
 * modo estreito — o modo em que a coluna e uma gaveta e nao ha divisoria
 * nenhuma para testar. Tela larga precisa ser declarada.
 */
function larguraDe(px: number): void {
  vi.stubGlobal('matchMedia', (consulta: string) => {
    const minimo = /min-width:\s*(\d+)px/.exec(consulta)
    return {
      matches: minimo ? px >= Number(minimo[1]) : false,
      media: consulta,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined,
      onchange: null, dispatchEvent: () => false,
    }
  })
}

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: CANAL, groupId: GRUPO, name: 'geral', type: 'text',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [{
    groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
    avatarUrl: null, role: 'owner', status: 'online',
  }],
  serverTime: '2026-09-25T12:00:00.000Z',
}

describe('paineis redimensionaveis', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // 1400px: acima dos dois pontos de quebra, entao as duas colunas sao
    // paineis de verdade e nao gavetas.
    larguraDe(1400)
    useStore.getState().limpar()
    act(() => useStore.getState().aplicarReady(READY))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('a divisoria e um separador anunciado e alcancável pelo teclado', () => {
    render(<AppShell />)

    const divisoria = screen.getByRole('separator', { name: /Redimensionar a lista de canais/ })
    expect(divisoria).toHaveAttribute('tabindex', '0')
    // Sem `aria-valuenow` o leitor de tela diz "separador" e nao diz ONDE a
    // coluna esta — que e a unica informacao util enquanto se arrasta sem ver.
    expect(divisoria).toHaveAttribute('aria-valuenow')
  })

  /**
   * A alternativa ao arrasto que a WCAG 2.5.7 exige.
   *
   * Quem usa switch, controle de cabeca ou tem tremor nas maos nao arrasta. Se
   * o botao do cabecalho nao existisse em tela larga, a coluna seria
   * intocavel para essa pessoa.
   */
  it('o botão do cabecalho recolhe a coluna em tela larga', async () => {
    render(<AppShell />)

    expect(screen.getByRole('navigation', { name: 'Canais do grupo' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar canais' }))

    // Recolhido significa FORA da arvore. Um `<nav>` de largura zero continua
    // tabulavel e continua sendo anunciado — esconder de quem enxerga e nao de
    // quem tabula e o defeito que este projeto ja decidiu nao cometer.
    expect(
      screen.queryByRole('navigation', { name: 'Canais do grupo' }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Abrir canais' }))
    expect(screen.getByRole('navigation', { name: 'Canais do grupo' })).toBeInTheDocument()
  })

  it('o painel de membros recolhe e volta pelo mesmo botão', async () => {
    render(<AppShell />)

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar membros' }))
    expect(screen.getByRole('button', { name: 'Mostrar membros' })).toHaveAttribute(
      'aria-expanded', 'false',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar membros' }))
    expect(screen.getByRole('button', { name: 'Ocultar membros' })).toHaveAttribute(
      'aria-expanded', 'true',
    )
  })

  it('o estado recolhido sobrevive a um remontar', async () => {
    const { unmount } = render(<AppShell />)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar canais' }))
    unmount()

    render(<AppShell />)
    expect(
      screen.queryByRole('navigation', { name: 'Canais do grupo' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir canais' })).toBeInTheDocument()
  })
})

describe('a largura guardada', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('sem nada guardado, vale o padrão da spec', () => {
    expect(lerLayout()).toEqual(LAYOUT_PADRAO)
  })

  it('guarda em pixel, e não em porcentagem', () => {
    window.localStorage.setItem('altcast:layout', JSON.stringify({
      ...LAYOUT_PADRAO, canaisPx: 300,
    }))
    // 300px continuam 300px em qualquer monitor. Guardado como porcentagem, a
    // mesma escolha voltaria como 192px num laptop depois de ter sido feita
    // num monitor de 2560px — e a pessoa acharia que o sistema esqueceu.
    expect(lerLayout().canaisPx).toBe(300)
  })

  it('limita valor absurdo em vez de aceitar', () => {
    window.localStorage.setItem('altcast:layout', JSON.stringify({ canaisPx: 4000 }))
    expect(lerLayout().canaisPx).toBe(CANAIS_MAX)

    window.localStorage.setItem('altcast:layout', JSON.stringify({ canaisPx: 10 }))
    expect(lerLayout().canaisPx).toBe(CANAIS_MIN)
  })

  it('JSON corrompido não derruba a tela', () => {
    window.localStorage.setItem('altcast:layout', 'isto nao e json')
    expect(lerLayout()).toEqual(LAYOUT_PADRAO)
  })

  it('largura zero cai numa referência em vez de dividir por zero', () => {
    // Acontece no jsdom e no primeiro quadro, antes de medir.
    expect(Number.isFinite(pctDe(240, 0))).toBe(true)
    expect(pctDe(240, 0)).toBeGreaterThan(0)
    expect(pxDe(pctDe(240, 1200), 1200)).toBe(240)
  })
})
