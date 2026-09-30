import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import {
  FALA_PADRAO, FOLGA_DE_SOLTURA_MS, escrevendoEm, guardarFala, lerFala, rotuloDoAtalho,
  semModificador, useAtalhosDaChamada,
} from '../src/features/voice/atalhos.js'
import {
  plantarChamadaParaTeste, useChamadaAtiva, zerarChamadaParaTeste,
} from '../src/features/voice/chamadaAtiva.js'
import type { Chamada } from '../src/lib/midia.js'

/**
 * Push-to-talk e os atalhos.
 *
 * O que mais precisa de prova aqui nao e o caminho feliz — apertou, falou — e
 * sim os dois modos de falhar que tornariam a funcionalidade pior do que a
 * ausencia dela: cortar a ultima silaba de toda frase, e disparar enquanto a
 * pessoa escreve no chat.
 */

function Sonda(): null {
  useAtalhosDaChamada()
  return null
}

/** Um duble so com o que os atalhos usam. */
function espionarChamada(): {
  definirMicrofone: ReturnType<typeof vi.fn>
  definirSurdo: ReturnType<typeof vi.fn>
} {
  const nada = async (): Promise<void> => undefined
  const espioes = {
    definirMicrofone: vi.fn(nada),
    definirSurdo: vi.fn(nada),
  }
  act(() => {
    plantarChamadaParaTeste({
      entrar: nada,
      sair: nada,
      trocarDispositivo: nada,
      destravarAudio: nada,
      definirCamera: nada,
      definirTela: nada,
      definirVolume: () => undefined,
      restaurarVolumes: () => undefined,
      definirQualidade: () => undefined,
      definirQualidadeDeRecepcao: () => undefined,
      estado: () => useChamadaAtiva.getState().chamada,
      ...espioes,
    } as unknown as Chamada, 'c-voz')
  })
  return espioes
}

const teclar = (tipo: 'keydown' | 'keyup', code: string, alvo?: HTMLElement): void => {
  act(() => {
    const evento = new KeyboardEvent(tipo, { code, bubbles: true, cancelable: true })
    ;(alvo ?? window).dispatchEvent(evento)
  })
}

describe('atalhos da chamada', () => {
  beforeEach(() => {
    localStorage.clear()
    zerarChamadaParaTeste()
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('M alterna o microfone', () => {
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'KeyM')

    expect(espioes.definirMicrofone).toHaveBeenCalledWith(true)
  })

  it('D ensurdece', () => {
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'KeyD')

    expect(espioes.definirSurdo).toHaveBeenCalledWith(true)
  })

  it('escrever no chat não mexe no microfone', () => {
    const espioes = espionarChamada()
    render(<Sonda />)
    const campo = document.createElement('textarea')
    document.body.appendChild(campo)

    teclar('keydown', 'KeyM', campo)
    teclar('keydown', 'KeyD', campo)

    // Sem esta regra, escrever "amanha" silenciaria o microfone no "m" — e a
    // pessoa nao teria como relacionar as duas coisas.
    expect(espioes.definirMicrofone).not.toHaveBeenCalled()
    expect(espioes.definirSurdo).not.toHaveBeenCalled()
    campo.remove()
  })

  it('o atalho de mudo gravado nas configurações substitui o M', () => {
    guardarFala({
      ...FALA_PADRAO,
      mudo: { code: 'KeyK', ctrl: true, alt: false, shift: true, meta: false },
    })
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'KeyM')
    expect(espioes.definirMicrofone).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
      }))
    })
    expect(espioes.definirMicrofone).toHaveBeenCalledWith(true)
  })

  it('modificador exato: Ctrl+Shift+K não dispara um atalho gravado como Ctrl+K', () => {
    guardarFala({
      ...FALA_PADRAO,
      mudo: { code: 'KeyK', ctrl: true, alt: false, shift: false, meta: false },
    })
    const espioes = espionarChamada()
    render(<Sonda />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
      }))
    })
    expect(espioes.definirMicrofone).not.toHaveBeenCalled()
  })

  it('atalho com Ctrl vale até digitando no chat', () => {
    guardarFala({
      ...FALA_PADRAO,
      mudo: { code: 'KeyM', ctrl: true, alt: false, shift: false, meta: false },
    })
    const espioes = espionarChamada()
    render(<Sonda />)
    const campo = document.createElement('textarea')
    document.body.appendChild(campo)

    act(() => {
      campo.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyM', ctrlKey: true, bubbles: true, cancelable: true,
      }))
    })

    expect(espioes.definirMicrofone).toHaveBeenCalledWith(true)
    campo.remove()
  })

  it('trocar o atalho no meio da chamada vale na hora', () => {
    const espioes = espionarChamada()
    render(<Sonda />)

    act(() => { guardarFala({ ...FALA_PADRAO, mudo: semModificador('KeyJ') }) })
    teclar('keydown', 'KeyM')
    expect(espioes.definirMicrofone).not.toHaveBeenCalled()

    teclar('keydown', 'KeyJ')
    expect(espioes.definirMicrofone).toHaveBeenCalledWith(true)
  })

  it('atalho removido não dispara nada', () => {
    guardarFala({ ...FALA_PADRAO, surdo: null })
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'KeyD')
    expect(espioes.definirSurdo).not.toHaveBeenCalled()
  })

  it('o rótulo diz a combinação como a pessoa a reconhece', () => {
    expect(rotuloDoAtalho({ code: 'KeyM', ctrl: true, alt: false, shift: true, meta: false }))
      .toBe('Ctrl + Shift + M')
    expect(rotuloDoAtalho(semModificador('Space'))).toBe('Espaço')
    expect(rotuloDoAtalho(semModificador('Digit1'))).toBe('1')
    expect(rotuloDoAtalho(null)).toBe('Nenhum')
  })

  it('sem chamada nenhuma os atalhos não existem', () => {
    const espioes = espionarChamada()
    act(() => { zerarChamadaParaTeste() })
    render(<Sonda />)

    teclar('keydown', 'KeyM')

    expect(espioes.definirMicrofone).not.toHaveBeenCalled()
  })
})

describe('apertar para falar', () => {
  beforeEach(() => {
    localStorage.clear()
    guardarFala({ ...FALA_PADRAO, modo: 'apertar', tecla: 'Space' })
    zerarChamadaParaTeste()
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('apertar abre o microfone e soltar só o fecha depois da folga', () => {
    vi.useFakeTimers()
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'Space')
    expect(espioes.definirMicrofone).toHaveBeenCalledWith(true)

    teclar('keyup', 'Space')
    // Fechar no mesmo instante corta a ultima silaba de TODA frase: a pessoa
    // solta a tecla exatamente quando termina de falar.
    expect(espioes.definirMicrofone).not.toHaveBeenCalledWith(false)

    act(() => { vi.advanceTimersByTime(FOLGA_DE_SOLTURA_MS) })
    expect(espioes.definirMicrofone).toHaveBeenCalledWith(false)
  })

  it('segurar a tecla não reabre o microfone a cada repetição', () => {
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'Space')
    teclar('keydown', 'Space')
    teclar('keydown', 'Space')

    // O auto-repeat do teclado dispara dezenas de `keydown` por segundo.
    expect(espioes.definirMicrofone).toHaveBeenCalledTimes(1)
  })

  it('perder o foco da janela fecha o microfone na hora', () => {
    const espioes = espionarChamada()
    render(<Sonda />)
    teclar('keydown', 'Space')

    act(() => { window.dispatchEvent(new Event('blur')) })

    // Se a tecla for solta com a aba em segundo plano, o `keyup` nunca chega e
    // o microfone ficaria aberto indefinidamente. Cortar cedo e melhor do que
    // transmitir sem querer.
    expect(espioes.definirMicrofone).toHaveBeenCalledWith(false)
  })

  it('no modo aberto a barra de espaço não mexe em nada', () => {
    guardarFala({ ...FALA_PADRAO, modo: 'aberto', tecla: 'Space' })
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'Space')

    expect(espioes.definirMicrofone).not.toHaveBeenCalled()
  })
})

describe('preferencias de fala', () => {
  it('microfone aberto e o padrão de quem nunca escolheu', () => {
    localStorage.clear()
    expect(lerFala()).toMatchObject({ modo: 'aberto', tecla: 'Space' })
    expect(lerFala().mudo?.code).toBe('KeyM')
    expect(lerFala().surdo?.code).toBe('KeyD')
  })

  it('a tecla e guardada por posição fisica, e não por letra', () => {
    localStorage.clear()
    guardarFala({ ...FALA_PADRAO, modo: 'apertar', tecla: 'KeyQ' })

    // `code` e nao `key`: a mesma tecla devolve "q" num QWERTY e "a" num
    // AZERTY, e um atalho gravado por letra morreria ao trocar de layout.
    expect(lerFala().tecla).toBe('KeyQ')
    localStorage.clear()
  })

  it('um editor rico conta como campo de texto', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')

    // Um teste de `tagName` sozinho perderia este caso: editor rico e `div`.
    expect(escrevendoEm(editor)).toBe(true)
  })

  it('um elemento DENTRO de um editor rico também conta', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const negrito = document.createElement('strong')
    editor.appendChild(negrito)

    // O alvo do evento e o no mais interno, e nao a raiz editavel: sem subir a
    // arvore, escrever dentro de qualquer formatacao voltaria a disparar
    // atalhos.
    expect(escrevendoEm(negrito)).toBe(true)
  })

  it('um paragrafo comum não conta', () => {
    expect(escrevendoEm(document.createElement('p'))).toBe(false)
  })
})
