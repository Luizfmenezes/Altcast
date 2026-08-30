import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import {
  FOLGA_DE_SOLTURA_MS, escrevendoEm, guardarFala, lerFala, useAtalhosDaChamada,
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

  it('escrever no chat nao mexe no microfone', () => {
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

  it('sem chamada nenhuma os atalhos nao existem', () => {
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
    guardarFala({ modo: 'apertar', tecla: 'Space' })
    zerarChamadaParaTeste()
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('apertar abre o microfone e soltar so o fecha depois da folga', () => {
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

  it('segurar a tecla nao reabre o microfone a cada repeticao', () => {
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

  it('no modo aberto a barra de espaco nao mexe em nada', () => {
    guardarFala({ modo: 'aberto', tecla: 'Space' })
    const espioes = espionarChamada()
    render(<Sonda />)

    teclar('keydown', 'Space')

    expect(espioes.definirMicrofone).not.toHaveBeenCalled()
  })
})

describe('preferencias de fala', () => {
  it('microfone aberto e o padrao de quem nunca escolheu', () => {
    localStorage.clear()
    expect(lerFala()).toEqual({ modo: 'aberto', tecla: 'Space' })
  })

  it('a tecla e guardada por posicao fisica, e nao por letra', () => {
    localStorage.clear()
    guardarFala({ modo: 'apertar', tecla: 'KeyQ' })

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

  it('um elemento DENTRO de um editor rico tambem conta', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const negrito = document.createElement('strong')
    editor.appendChild(negrito)

    // O alvo do evento e o no mais interno, e nao a raiz editavel: sem subir a
    // arvore, escrever dentro de qualquer formatacao voltaria a disparar
    // atalhos.
    expect(escrevendoEm(negrito)).toBe(true)
  })

  it('um paragrafo comum nao conta', () => {
    expect(escrevendoEm(document.createElement('p'))).toBe(false)
  })
})
