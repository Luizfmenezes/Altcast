import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PainelMembros } from '../src/features/presence/PainelMembros.js'
import { BarraConexao } from '../src/features/presence/BarraConexao.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'member' }],
  channels: [],
  members: [
    {
      groupId: 'g1', userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'member', status: 'offline',
    },
    {
      groupId: 'g1', userId: 'u2', displayName: 'Ana',
      avatarUrl: null, role: 'admin', status: 'online',
    },
  ],
  serverTime: '2026-08-29T12:00:00.000Z',
}

describe('presenca e conexao', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('presenca nunca depende so de cor', () => {
    render(<PainelMembros />)

    // Nome e estado no mesmo rotulo: quem usa leitor de tela ouve a frase
    // inteira, e quem nao distingue verde de cinza le a palavra.
    expect(screen.getByLabelText('Ana, online')).toBeInTheDocument()
    expect(screen.getByLabelText('Felipe, offline')).toBeInTheDocument()
  })

  it('a forma distingue online de offline sem depender do matiz', () => {
    render(<PainelMembros />)

    const online = screen.getByLabelText('Ana, online').querySelector('[data-presenca]')
    const offline = screen.getByLabelText('Felipe, offline').querySelector('[data-presenca]')
    // Circulo cheio contra circulo vazado: a diferenca sobrevive a uma captura
    // em escala de cinza.
    expect(online).toHaveAttribute('data-presenca', 'cheio')
    expect(offline).toHaveAttribute('data-presenca', 'vazado')
  })

  it('presenca muda quando o evento chega, sem recarregar', () => {
    render(<PainelMembros />)
    expect(screen.getByLabelText('Felipe, offline')).toBeInTheDocument()

    act(() => useStore.getState().aplicarEvento({
      t: 'presence.update', d: { userId: 'u1', status: 'online' },
    }))

    expect(screen.getByLabelText('Felipe, online')).toBeInTheDocument()
  })

  it('quem esta online aparece antes de quem nao esta', () => {
    render(<PainelMembros />)
    const nomes = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(nomes[0]).toContain('Ana')
  })

  it('a barra de conexao diz a verdade sobre o socket', () => {
    useStore.getState().definirConexao('conectado')
    render(<BarraConexao />)
    expect(screen.getByRole('status')).toHaveTextContent('conectado')

    act(() => useStore.getState().definirConexao('reconectando'))
    expect(screen.getByRole('status')).toHaveTextContent('reconectando')
  })

  it('a barra mostra a latencia medida pelo heartbeat', () => {
    useStore.getState().definirConexao('conectado')
    render(<BarraConexao latenciaMs={42} />)

    expect(screen.getByRole('status')).toHaveTextContent('42 ms')
  })

  it('sem conexao a latencia some, em vez de mentir um numero velho', () => {
    useStore.getState().definirConexao('reconectando')
    render(<BarraConexao latenciaMs={42} />)

    expect(screen.getByRole('status')).not.toHaveTextContent('42 ms')
  })

  it('mudanca de estado e anunciada sem interromper', () => {
    useStore.getState().definirConexao('conectado')
    render(<BarraConexao />)

    // `status` ja implica aria-live="polite": o aviso espera a pausa em vez de
    // cortar o que estiver sendo lido.
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
