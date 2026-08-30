import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FaixaDeMidia } from '../src/features/voice/FaixaDeMidia.js'
import type { Faixa } from '../src/lib/midia.js'
import { violacoes } from './helpers/axe.js'

/**
 * Uma faixa com a superficie minima que o componente usa. O `track` de verdade
 * do LiveKit traz meia biblioteca junto; o que este arquivo testa e o que
 * acontece EM VOLTA do video — tela cheia, mini player e volume — e nada disso
 * depende de um SFU de pe.
 */
function faixaDe(papel: Faixa['papel'], local = false): Faixa {
  return {
    userId: 'u2',
    papel,
    local,
    track: { attach: vi.fn(), detach: vi.fn(), sid: 'TR_1' },
  } as unknown as Faixa
}

/**
 * jsdom nao implementa nem tela cheia nem mini player — sao capacidades do
 * navegador de verdade. Ligamos as duas na mao para poder testar a DECISAO do
 * componente (qual API ele chama, e sobre qual elemento), que e a parte que
 * nos pertence.
 */
function ligarCapacidades(): { cheia: ReturnType<typeof vi.fn>; pip: ReturnType<typeof vi.fn> } {
  const cheia = vi.fn(async () => undefined)
  const pip = vi.fn(async () => ({}))
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
  Object.defineProperty(document, 'pictureInPictureEnabled', { value: true, configurable: true })
  Object.defineProperty(Element.prototype, 'requestFullscreen', { value: cheia, configurable: true })
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
    value: pip, configurable: true,
  })
  return { cheia, pip }
}

describe('controles de uma transmissao', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    Object.defineProperty(document, 'pictureInPictureElement', { value: null, configurable: true })
  })

  it('a tela cheia vai para a MOLDURA, e nao para o video', async () => {
    const { cheia } = ligarCapacidades()
    render(<FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" />)

    await userEvent.click(screen.getByRole('button', { name: /Tela cheia de Ana — tela/ }))

    // Ampliar o proprio <video> deixaria os controles — volume, mini player,
    // o nome de quem transmite — atras da imagem, inalcancaveis justamente
    // quando a transmissao ocupa o monitor inteiro.
    expect(cheia).toHaveBeenCalledTimes(1)
    expect((cheia.mock.instances[0] as unknown as HTMLElement).tagName).toBe('FIGURE')
  })

  it('o mini player e uma janela do navegador, pedida ao proprio video', async () => {
    const { pip } = ligarCapacidades()
    render(<FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" />)

    await userEvent.click(screen.getByRole('button', { name: /Mini player de Ana — tela/ }))

    // E o que faz a transmissao ficar por cima do editor ou do jogo, como o
    // mini player de musica faz — um retangulo da propria pagina nao ficaria.
    expect(pip).toHaveBeenCalledTimes(1)
    expect((pip.mock.instances[0] as unknown as HTMLElement).tagName).toBe('VIDEO')
  })

  it('a propria transmissao nao oferece mini player', () => {
    ligarCapacidades()
    render(<FaixaDeMidia faixa={faixaDe('tela', true)} rotulo="Voce" />)

    // Quem compartilha ja ve a propria tela em tamanho natural, atras da aba.
    expect(screen.queryByRole('button', { name: /Mini player/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tela cheia/ })).toBeInTheDocument()
  })

  it('o navegador sem essas capacidades nao ganha botao morto', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true })
    Object.defineProperty(document, 'pictureInPictureEnabled', { value: false, configurable: true })
    render(<FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" />)

    expect(screen.queryByRole('button', { name: /Tela cheia/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mini player/ })).not.toBeInTheDocument()
  })

  it('o cursor mostra o volume da faixa, e nao um valor solto', () => {
    ligarCapacidades()
    render(
      <FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" volume={0.35} aoMudarVolume={vi.fn()} />,
    )

    // O `range` do HTML so fala em inteiros e o LiveKit so aceita 0 a 1: a
    // conversao mora no componente para que nenhum chamador precise saber.
    expect(screen.getByRole('slider', { name: /Volume de Ana — tela/ })).toHaveValue('35')
  })

  it('silenciar leva a zero e reativar devolve o volume anterior', async () => {
    ligarCapacidades()
    const mudou = vi.fn()
    const { rerender } = render(
      <FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" volume={0.6} aoMudarVolume={mudou} />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Silenciar Ana — tela/ }))
    expect(mudou).toHaveBeenLastCalledWith(0)

    rerender(
      <FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" volume={0} aoMudarVolume={mudou} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Reativar o som de Ana — tela/ }))

    // Devolver 1 apagaria o ajuste: quem tinha baixado para 0,6 antes de
    // silenciar espera 0,6 de volta, e nao o volume no talo.
    expect(mudou).toHaveBeenLastCalledWith(0.6)
  })

  it('sem som proprio a transmissao nao mostra um cursor que nao move nada', () => {
    ligarCapacidades()
    render(<FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" />)

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('axe nao encontra violacao nos controles sobre o video', async () => {
    ligarCapacidades()
    const { container } = render(
      <FaixaDeMidia faixa={faixaDe('tela')} rotulo="Ana" volume={0.5} aoMudarVolume={vi.fn()} />,
    )

    expect(await violacoes(container)).toEqual([])
  })
})
