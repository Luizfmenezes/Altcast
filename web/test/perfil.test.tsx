import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Perfil } from '../src/features/settings/Perfil.js'
import { Abas, PainelDeAba } from '../src/ui/Abas.js'
import { useStore } from '../src/lib/store.js'
import { violacoes } from './helpers/axe.js'

/**
 * Perfil: nome de exibicao, handle e foto.
 *
 * Tres coisas que existiam no banco e nao existiam na tela — o nome de
 * exibicao nao podia ser trocado por ninguem, o handle nao existia, e o avatar
 * era uma coluna que so o Google preenchia.
 */

function comUsuario(extra: Record<string, unknown> = {}): void {
  act(() => {
    useStore.setState({
      user: {
        id: 'u1', displayName: 'Felipe', avatarUrl: null,
        email: 'felipe@exemplo.com', emailVerifiedAt: '2026-09-01T00:00:00.000Z',
        username: null, ...extra,
      },
    })
  })
}

describe('tela de perfil', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    comUsuario()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('salvar o nome de exibicao manda o PATCH e atualiza a store', async () => {
    const chamadas: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      chamadas.push(`${String(init?.method)} ${String(url)}`)
      return new Response(
        JSON.stringify({ user: { id: 'u1', displayName: 'Felipe Menezes', avatarUrl: null } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    render(<Perfil />)
    const campo = screen.getByLabelText(/Como os outros te veem/)
    await userEvent.clear(campo)
    await userEvent.type(campo, 'Felipe Menezes')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))

    await waitFor(() => {
      expect(useStore.getState().user?.displayName).toBe('Felipe Menezes')
    })
    expect(chamadas[0]).toBe('PATCH /api/auth/me')
  })

  it('nao deixa salvar o nome que ja esta la', () => {
    render(<Perfil />)
    expect(screen.getByRole('button', { name: 'Salvar nome' })).toBeDisabled()
  })

  /**
   * O servidor devolve o motivo exato em `details.username` — "use apenas
   * letras minusculas", e nao "invalido". Perder esse motivo pelo caminho
   * mandaria a pessoa adivinhar o que corrigir.
   */
  it('o motivo da recusa do handle vem do servidor, campo a campo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          code: 'validation_failed',
          message: 'Alguns campos precisam de atencao.',
          details: { username: ['Use apenas letras minusculas, numeros, ponto e sublinhado.'] },
        },
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ))

    render(<Perfil />)
    await userEvent.type(screen.getByLabelText(/Como te encontram/), 'Com Espaco')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome de usuario' }))

    expect(await screen.findByText(/letras minusculas/)).toBeInTheDocument()
  })

  it('handle ja tomado aparece como tal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        error: { code: 'username_taken', message: 'Este nome de usuario ja esta em uso.' },
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ))

    render(<Perfil />)
    await userEvent.type(screen.getByLabelText(/Como te encontram/), 'felipe')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome de usuario' }))

    expect(await screen.findByText(/ja esta em uso/)).toBeInTheDocument()
  })

  it('sem foto nao oferece remover', () => {
    render(<Perfil />)
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument()
  })

  it('com foto oferece remover', () => {
    comUsuario({ avatarUrl: '/api/avatars/abc' })
    render(<Perfil />)
    expect(screen.getByRole('button', { name: /Remover/ })).toBeInTheDocument()
  })

  it('axe nao encontra violacao', async () => {
    const { container } = render(<Perfil />)
    expect(await violacoes(container)).toEqual([])
  })
})

describe('as abas de configuracao', () => {
  function Exemplo(): React.ReactElement {
    const [aba, setAba] = React.useState('um')
    return (
      <Abas
        abas={[
          { valor: 'um', rotulo: 'Primeira' },
          { valor: 'dois', rotulo: 'Segunda' },
          { valor: 'tres', rotulo: 'Terceira' },
        ]}
        valor={aba}
        aoMudar={setAba}
        rotulo="Exemplo"
      >
        <PainelDeAba valor="um"><p>conteudo um</p></PainelDeAba>
        <PainelDeAba valor="dois"><p>conteudo dois</p></PainelDeAba>
        <PainelDeAba valor="tres"><p>conteudo tres</p></PainelDeAba>
      </Abas>
    )
  }

  /**
   * A versao anterior anunciava `role="tab"` e nao respondia a seta nenhuma —
   * o que e pior do que nao anunciar: diz ao leitor de tela "use as setas
   * aqui" e depois nao cumpre, deixando a pessoa presa.
   */
  it('a seta anda entre as abas', async () => {
    render(<Exemplo />)
    const primeira = screen.getByRole('tab', { name: 'Primeira' })
    primeira.focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(primeira).toHaveAttribute('aria-selected', 'true')
  })

  it('so o painel selecionado esta na arvore', () => {
    render(<Exemplo />)
    expect(screen.getByText('conteudo um')).toBeInTheDocument()
    expect(screen.queryByText('conteudo dois')).not.toBeInTheDocument()
  })

  it('axe nao encontra violacao', async () => {
    const { container } = render(<Exemplo />)
    expect(await violacoes(container)).toEqual([])
  })
})
