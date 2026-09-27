import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { violacoes } from './helpers/axe.js'
import { AppShell } from '../src/AppShell.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const GRUPO = 'g1'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [
    { id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'member' },
    { id: 'g2', name: 'Estudos', iconUrl: null, role: 'owner' },
  ],
  channels: [
    { id: 'c1', groupId: GRUPO, name: 'geral', type: 'text', visibility: 'public', topic: null, position: 0 },
    { id: 'c2', groupId: GRUPO, name: 'planejamento', type: 'text', visibility: 'public', topic: null, position: 1 },
    { id: 'c3', groupId: GRUPO, name: 'reuniao', type: 'voice', visibility: 'public', topic: null, position: 2 },
    { id: 'c4', groupId: 'g2', name: 'calculo', type: 'text', visibility: 'private', topic: null, position: 0 },
  ],
  members: [
    { groupId: GRUPO, userId: 'u1', displayName: 'Felipe', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: GRUPO, userId: 'u2', displayName: 'Ana Paula', avatarUrl: null, role: 'admin', status: 'offline' },
  ],
  serverTime: '2026-08-29T12:00:00.000Z',
}

function larguraDe(px: number): void {
  vi.stubGlobal('matchMedia', (consulta: string) => {
    const minimo = /min-width:\s*(\d+)px/.exec(consulta)
    return {
      matches: minimo ? px >= Number(minimo[1]) : false,
      media: consulta, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined,
      dispatchEvent: () => false,
    }
  })
}

describe('paleta de comandos', () => {
  beforeEach(() => {
    larguraDe(1440)
    act(() => { useStore.getState().aplicarReady(READY) })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => { useStore.getState().limpar() })
  })

  async function abrir(): Promise<void> {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
  }

  it('Ctrl+K abre a busca', async () => {
    await abrir()
    expect(screen.getByLabelText('Buscar canais, grupos ou pessoas')).toHaveFocus()
  })

  it('Escape fecha', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.keyboard('{Escape}')
    expect(screen.queryByLabelText('Buscar canais, grupos ou pessoas')).not.toBeInTheDocument()
  })

  it('filtra ignorando acento e caixa', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'REUNIÃO')

    const opcoes = screen.getAllByRole('option').map(li => li.textContent)
    expect(opcoes.some(t => t?.includes('reuniao'))).toBe(true)
    expect(opcoes.some(t => t?.includes('geral'))).toBe(false)
  })

  // Encontrar o canal e mudar de grupo de uma vez: um resultado que abrisse um
  // canal de outro grupo sem trocar o grupo deixaria a barra lateral mentindo.
  it('escolher um canal de outro grupo troca o grupo junto', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'calculo')
    await usuario.click(screen.getByRole('option', { name: /calculo/ }))

    expect(useStore.getState().grupoAtivo).toBe('g2')
    expect(useStore.getState().canalAtivo).toBe('c4')
    expect(screen.queryByLabelText('Buscar canais, grupos ou pessoas')).not.toBeInTheDocument()
  })

  it('acha pessoas, e não só canais', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'ana')
    expect(screen.getByRole('option', { name: /Ana Paula/ })).toBeInTheDocument()
  })

  it('as setas movem o item ativo e Enter abre, sem sair do campo', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    const campo = screen.getByLabelText('Buscar canais, grupos ou pessoas')
    await usuario.type(campo, 'p')

    // "planejamento" comeca com p e vem primeiro; "Ana Paula" so contem.
    const [primeira, segunda] = screen.getAllByRole('option')
    expect(primeira).toHaveAttribute('aria-selected', 'true')
    expect(campo).toHaveAttribute('aria-activedescendant', primeira!.id)

    await usuario.keyboard('{ArrowDown}')
    expect(segunda).toHaveAttribute('aria-selected', 'true')
    expect(campo).toHaveFocus()

    await usuario.keyboard('{ArrowUp}{Enter}')
    expect(useStore.getState().canalAtivo).toBe('c2')
  })

  it('quem divide dois grupos comigo aparece uma vez só', async () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'member.joined',
        d: { groupId: 'g2', userId: 'u2', displayName: 'Ana Paula', avatarUrl: null, role: 'member', status: 'offline' },
      })
    })
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'ana')

    expect(screen.getAllByRole('option', { name: /Ana Paula/ })).toHaveLength(1)
    expect(screen.getByRole('option', { name: /Ana Paula/ })).toHaveTextContent('2 grupos')
  })

  it('escolher uma pessoa abre o cartão de perfil dela', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'ana')
    await usuario.keyboard('{Enter}')

    const cartao = await screen.findByRole('dialog', { name: 'Ana Paula' })
    expect(cartao).toHaveTextContent('Grupos em comum')
  })

  it('diz quando não achou, em vez de mostrar uma lista vazia', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    await usuario.type(screen.getByLabelText('Buscar canais, grupos ou pessoas'), 'zzzzz')
    expect(screen.getByText(/Nada encontrado/)).toBeInTheDocument()
  })

  it('axe não encontra violação com a paleta aberta', async () => {
    const usuario = userEvent.setup()
    const { baseElement } = render(<AppShell />)
    await usuario.keyboard('{Control>}k{/Control}')
    // baseElement, e nao container: a Radix leva o dialogo para um portal fora
    // da arvore do componente.
    expect(await violacoes(baseElement as HTMLElement)).toEqual([])
  })
})
