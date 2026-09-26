import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CriarGrupo } from '../src/features/groups/CriarGrupo.js'
import { ProvedorDeDicas } from '../src/ui/Tooltip.js'
import { useStore } from '../src/lib/store.js'
import type { CotaDeGrupos } from '../src/lib/tipos.js'

/**
 * A jornada de quem acaba de chegar.
 *
 * "Entrar no site, criar uma conta, criar o meu grupo e compartilhar com
 * outras pessoas" — o ultimo passo era o que faltava. O grupo nascia e o
 * dialogo fechava, deixando a pessoa diante de um canal vazio; o link que
 * torna o grupo util morava tres cliques adiante, em Configuracoes > Grupo.
 */

const escrita: string[] = []

function prepararAreaDeTransferencia(): void {
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(async (t: string) => { escrita.push(t); return undefined }),
    },
  })
}

function comCota(cota: CotaDeGrupos | null): void {
  act(() => { useStore.setState({ cotaDeGrupos: cota }) })
}

function desenhar(): void {
  render(<ProvedorDeDicas><CriarGrupo /></ProvedorDeDicas>)
}

describe('criar grupo e ja sair com o convite na mao', () => {
  beforeEach(() => {
    escrita.length = 0
    prepararAreaDeTransferencia()
    useStore.getState().limpar()
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('criar o grupo abre a etapa do convite com o link copiado', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: RequestInfo | URL) => {
      const url = String(entrada)
      if (url.endsWith('/api/groups')) {
        return new Response(
          JSON.stringify({ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'owner' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/groups/g1/invites')) {
        return new Response(JSON.stringify({ code: 'K7M2P9XQ' }),
          { status: 201, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`rota inesperada: ${url}`)
    })

    desenhar()
    await userEvent.click(screen.getByRole('button', { name: /Criar grupo/ }))
    await userEvent.type(screen.getByLabelText(/Nome do grupo/), 'Anticorp')
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    // O dialogo NAO fecha: ele vira a tela do convite.
    await waitFor(() => {
      expect(screen.getByText(/Anticorp esta pronto/)).toBeInTheDocument()
    })

    const campo = screen.getByLabelText(/Link de convite/) as HTMLInputElement
    expect(campo.value).toMatch(/\/convite\/K7M2P9XQ$/)
    // E ja esta na area de transferencia, sem a pessoa precisar clicar.
    await waitFor(() => { expect(escrita[0]).toMatch(/\/convite\/K7M2P9XQ$/) })
  })

  /**
   * Emitir convite passa pelo MESMO portao de e-mail confirmado que criar
   * grupo. Falhar no segundo pedido nao pode virar um erro sobre um grupo que
   * na verdade foi criado.
   */
  it('convite que falha nao apaga o grupo que deu certo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: RequestInfo | URL) => {
      const url = String(entrada)
      if (url.endsWith('/api/groups')) {
        return new Response(
          JSON.stringify({ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'owner' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ error: { code: 'email_not_verified', message: 'Confirme seu e-mail.' } }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    })

    desenhar()
    await userEvent.click(screen.getByRole('button', { name: /Criar grupo/ }))
    await userEvent.type(screen.getByLabelText(/Nome do grupo/), 'Anticorp')
    await userEvent.click(screen.getByRole('button', { name: 'Criar grupo' }))

    await waitFor(() => {
      expect(screen.getByText(/Anticorp esta pronto/)).toBeInTheDocument()
    })
    expect(screen.getByText(/gera nas configuracoes/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Link de convite/)).not.toBeInTheDocument()
  })

  it('o gatilho conta quantos grupos ainda cabem', () => {
    comCota({ used: 2, max: 3 })
    desenhar()
    expect(screen.getByRole('button', { name: /2 de 3/ })).toBeEnabled()
  })

  /**
   * Desabilitado COM motivo, e nao escondido. Esconder deixaria a pessoa
   * procurando um botao que existia ontem.
   */
  it('no teto o gatilho desabilita dizendo por que', () => {
    comCota({ used: 3, max: 3 })
    desenhar()
    const botao = screen.getByRole('button', { name: /ja criou o maximo de 3 grupos/ })
    expect(botao).toBeDisabled()
  })

  it('administrador da plataforma nao ve teto nenhum', () => {
    comCota({ used: 9, max: null })
    desenhar()
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled()
  })

  it('servidor que nao fala de cota nao inventa um teto', () => {
    comCota(null)
    desenhar()
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeEnabled()
  })
})
