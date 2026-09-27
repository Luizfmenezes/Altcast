import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeletorDeFonte } from '../src/features/voice/SeletorDeFonte.js'
import {
  definirNativoParaTeste, esquecerNativoParaTeste, naoNativoParaTeste, nativo,
} from '../src/lib/nativo.js'
import type { FonteDeTela, PonteNativa } from '../src/lib/nativo.js'
import { violacoes } from './helpers/axe.js'

/**
 * O seletor de tela nativo, e a deteccao que decide se ele existe.
 *
 * Os dois moram no mesmo arquivo porque testam as duas metades da MESMA
 * invariante: a interface e uma so, servida pela mesma URL, e a diferenca
 * entre navegador e app e uma capacidade presente ou ausente — nunca um build
 * separado. Um teste que so cobrisse o caminho nativo deixaria justamente o
 * caminho de sempre sem rede de protecao.
 */

const FONTES: FonteDeTela[] = [
  {
    id: 'screen:0:0',
    nome: 'Tela 1',
    tipo: 'tela',
    miniatura: 'data:image/png;base64,iVBORw0KGgo=',
    icone: null,
  },
  {
    id: 'window:12:0',
    nome: 'Fulano - Jogo',
    tipo: 'janela',
    miniatura: 'data:image/png;base64,iVBORw0KGgo=',
    icone: 'data:image/png;base64,iVBORw0KGgo=',
  },
]

function ponteFalsa(parcial: Partial<PonteNativa> = {}): PonteNativa {
  return {
    versao: '1',
    listarFontes: vi.fn(async () => FONTES),
    escolherFonte: vi.fn(async () => undefined),
    ...parcial,
  }
}

afterEach(() => {
  esquecerNativoParaTeste()
  localStorage.clear()
})

describe('a deteccao do app de desktop', () => {
  it('no navegador não há ponte, e o caminho de sempre continua valendo', () => {
    naoNativoParaTeste()
    expect(nativo()).toBeNull()
  })

  it('uma ponte sem os metodos que a interface usa conta como navegador', () => {
    // O caso real: app antigo instalado contra interface nova. Chamar o que
    // nao existe daria um TypeError no meio de um clique; tratar como
    // navegador degrada para o caminho que sempre funcionou.
    const w = window as unknown as { altcast?: unknown }
    w.altcast = { versao: '1' }
    expect(nativo()).toBeNull()
    delete w.altcast
  })

  it('uma ponte completa e reconhecida', () => {
    const w = window as unknown as { altcast?: unknown }
    w.altcast = ponteFalsa()
    expect(nativo()).not.toBeNull()
    delete w.altcast
  })
})

describe('o seletor de tela do app', () => {
  it('separa telas de janelas e não oferece aba de navegador', async () => {
    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={vi.fn()}
        listar={async () => FONTES}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Telas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Janelas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tela 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fulano - Jogo/ })).toBeInTheDocument()
    // A lista vem de `desktopCapturer` com `types: ['screen', 'window']`. Aba
    // nao aparece porque nao e pedida — e o pedido que originou o app inteiro.
    expect(screen.queryByRole('heading', { name: /Abas/ })).not.toBeInTheDocument()
  })

  it('não transmite antes de confirmar', async () => {
    const aoEscolher = vi.fn()
    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={aoEscolher}
        listar={async () => FONTES}
      />,
    )

    const compartilhar = await screen.findByRole('button', { name: 'Compartilhar' })
    // Um clique que transmite na hora faz de qualquer erro de mira uma
    // transmissao da tela inteira para a sala, e o desfazer chega sempre
    // depois de alguem ja ter visto.
    expect(compartilhar).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Fulano - Jogo/ }))
    expect(compartilhar).toBeEnabled()
    expect(aoEscolher).not.toHaveBeenCalled()

    await userEvent.click(compartilhar)
    expect(aoEscolher).toHaveBeenCalledWith('window:12:0', 'sistema')
  })

  it('o som do sistema vai junto por padrão, inclusive numa JANELA', async () => {
    const aoEscolher = vi.fn()
    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={aoEscolher}
        listar={async () => FONTES}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Fulano - Jogo/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    // Este e o defeito que o app existe para consertar. No Chrome em Windows,
    // compartilhar uma janela NUNCA leva audio: a caixa "compartilhar audio"
    // so aparece para aba e para tela inteira, e quem mostrava a janela de um
    // jogo subia video e silencio sem erro em lugar nenhum.
    expect(aoEscolher).toHaveBeenCalledWith('window:12:0', 'sistema')
  })

  it('desligar o som e uma escolha lembrada na próxima transmissão', async () => {
    const aoEscolher = vi.fn()
    const props = {
      aberto: true as const,
      aoFechar: vi.fn(),
      aoEscolher,
      listar: async (): Promise<FonteDeTela[]> => FONTES,
    }
    const { unmount } = render(<SeletorDeFonte {...props} />)

    await userEvent.click(await screen.findByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /Tela 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))
    expect(aoEscolher).toHaveBeenCalledWith('screen:0:0', 'nenhum')

    unmount()
    render(<SeletorDeFonte {...props} />)
    // A escolha e da MAQUINA, como o microfone e a qualidade: quem desligou o
    // som do jogo uma vez nao quer reabrir o ajuste a cada transmissao.
    expect(await screen.findByRole('checkbox')).not.toBeChecked()
  })

  it('a escolha de uma janela que já fechou não sobrevive a atualização', async () => {
    let lista = FONTES
    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={vi.fn()}
        listar={async () => lista}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Fulano - Jogo/ }))
    expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeEnabled()

    // O jogo foi fechado enquanto o dialogo estava aberto.
    lista = FONTES.filter(f => f.tipo === 'tela')
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar a lista' }))

    // Sem a limpeza, o botao continuaria habilitado para uma fonte que nao
    // existe mais — e a falha apareceria depois do clique, ja dentro da
    // captura.
    expect(await screen.findByRole('button', { name: 'Compartilhar' })).toBeDisabled()
  })

  it('falhar em listar diz que falhou, em vez de mostrar uma lista vazia', async () => {
    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={vi.fn()}
        listar={async () => { throw new Error('sem permissão de captura') }}
      />,
    )

    // "Nenhuma tela disponivel" para um erro seria mentira, e mentira que
    // manda a pessoa procurar o problema no lugar errado.
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível listar/)
  })

  it('sem violações de acessibilidade', async () => {
    const { container } = render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={vi.fn()}
        listar={async () => FONTES}
      />,
    )
    await screen.findByRole('button', { name: /Tela 1/ })
    expect(await violacoes(container)).toEqual([])
  })
})

describe('a ponte, do lado da interface', () => {
  it('a fonte e escolhida ANTES de a captura começar', async () => {
    const ponte = ponteFalsa()
    definirNativoParaTeste(ponte)

    render(
      <SeletorDeFonte
        aberto
        aoFechar={vi.fn()}
        aoEscolher={(id, som) => { void ponte.escolherFonte(id, som) }}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Tela 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))

    // O processo principal guarda a escolha e a consome no `getDisplayMedia`
    // que o LiveKit dispara em seguida. Invertida, a ordem faria o handler nao
    // achar escolha nenhuma e negar a captura.
    expect(ponte.escolherFonte).toHaveBeenCalledWith('screen:0:0', 'sistema')
  })

  it('sem ponte e sem `listar`, o seletor admite que não tem o que listar', async () => {
    naoNativoParaTeste()
    render(<SeletorDeFonte aberto aoFechar={vi.fn()} aoEscolher={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
