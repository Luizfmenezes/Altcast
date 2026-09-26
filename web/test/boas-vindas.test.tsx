import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoasVindas } from '../src/features/groups/BoasVindas.js'
import { ProvedorDeDicas } from '../src/ui/Tooltip.js'
import { useStore } from '../src/lib/store.js'
import { normalizarCodigoDeConvite } from '../src/lib/convite.js'
import { violacoes } from './helpers/axe.js'

/**
 * A porta de entrada de quem chegou sozinho.
 *
 * Com cadastro aberto, esta e a PRIMEIRA tela de muita gente, e ela precisa
 * responder as duas perguntas reais: como crio um grupo, e como entro num que
 * ja existe. A versao anterior so respondia a primeira e mandava quem tinha
 * recebido um convite sair da aplicacao para procurar no e-mail.
 */

function comUsuario(verificado: boolean): void {
  act(() => {
    useStore.setState({
      user: {
        id: 'u1', displayName: 'Felipe', avatarUrl: null,
        email: 'felipe@exemplo.com',
        emailVerifiedAt: verificado ? '2026-09-01T00:00:00.000Z' : null,
      },
      groups: [],
    })
  })
}

function desenhar(): void {
  render(<ProvedorDeDicas><BoasVindas /></ProvedorDeDicas>)
}

describe('boas-vindas de quem nao tem grupo', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ google: true }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  })

  it('oferece as duas portas: criar e entrar por convite', () => {
    comUsuario(true)
    desenhar()

    expect(screen.getByRole('heading', { name: 'Criar um grupo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tenho um convite' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Link ou codigo do convite/)).toBeInTheDocument()
  })

  /**
   * Desabilitado COM motivo associado, e nao escondido.
   *
   * Esconder deixaria a pessoa procurando um botao; desabilitar sem explicar
   * deixaria ela achando que o sistema quebrou. O `aria-describedby` e o que
   * faz o leitor de tela dizer a razao junto com o estado.
   */
  it('sem e-mail confirmado o botao trava explicando por que', () => {
    comUsuario(false)
    desenhar()

    const botao = screen.getByRole('button', { name: /Criar meu primeiro grupo/ })
    expect(botao).toBeDisabled()

    const motivo = document.getElementById(botao.getAttribute('aria-describedby') ?? '')
    expect(motivo?.textContent).toMatch(/felipe@exemplo\.com/)
    expect(motivo?.textContent).toMatch(/Confirme/)
  })

  it('a trava oferece reenvio e a saida pelo Google', async () => {
    comUsuario(false)
    desenhar()

    expect(
      await screen.findByRole('link', { name: /Confirmar com o Google/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Reenviar e-mail de confirmacao/ }),
    ).toBeEnabled()
  })

  it('com e-mail confirmado nao ha trava nenhuma', () => {
    comUsuario(true)
    desenhar()

    expect(screen.getByRole('button', { name: /Criar meu primeiro grupo/ })).toBeEnabled()
    expect(screen.queryByText(/Confirme/)).not.toBeInTheDocument()
  })

  it('o botao de entrar so libera com um codigo plausivel', async () => {
    comUsuario(true)
    desenhar()

    const entrar = screen.getByRole('button', { name: 'Entrar no grupo' })
    expect(entrar).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Link ou codigo do convite/), 'K7M2P9XQ')
    expect(entrar).toBeEnabled()
  })

  it('axe nao encontra violacao', async () => {
    comUsuario(false)
    desenhar()
    expect(await violacoes(document.body)).toEqual([])
  })
})

describe('leitura do convite colado', () => {
  it('aceita o link inteiro', () => {
    expect(normalizarCodigoDeConvite('https://altcast.exemplo/convite/K7M2P9XQ'))
      .toBe('K7M2P9XQ')
  })

  it('aceita o link com barra no fim', () => {
    expect(normalizarCodigoDeConvite('https://altcast.exemplo/convite/K7M2P9XQ/'))
      .toBe('K7M2P9XQ')
  })

  it('aceita o codigo solto, em qualquer caixa', () => {
    expect(normalizarCodigoDeConvite('  k7m2p9xq  ')).toBe('K7M2P9XQ')
  })

  /**
   * O alfabeto e base32 de Crockford justamente para o codigo ser ditavel por
   * telefone. Quem ouve "K7M2P9XQ" e digita a letra O no lugar do zero merece
   * entrar, e nao uma pagina de erro.
   */
  it('perdoa as letras ambiguas, como o servidor perdoa', () => {
    expect(normalizarCodigoDeConvite('K7M2P9XO')).toBe('K7M2P9X0')
    expect(normalizarCodigoDeConvite('IL345678')).toBe('11345678')
  })

  it('recusa o que nao pode ser um codigo', () => {
    expect(normalizarCodigoDeConvite('')).toBeNull()
    expect(normalizarCodigoDeConvite('curto')).toBeNull()
    expect(normalizarCodigoDeConvite('https://altcast.exemplo/entrar')).toBeNull()
  })
})
