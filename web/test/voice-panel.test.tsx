import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PainelDeVoz } from '../src/features/voice/PainelDeVoz.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const GRUPO = 'g1'
const CANAL = 'c-voz'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: CANAL, groupId: GRUPO, name: 'sala-de-voz', type: 'voice',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [
    {
      groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'owner', status: 'online',
    },
    {
      groupId: GRUPO, userId: 'u2', displayName: 'Ana',
      avatarUrl: null, role: 'member', status: 'online',
    },
  ],
  serverTime: '2026-08-29T12:00:00.000Z',
}

describe('painel de voz', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    act(() => useStore.getState().aplicarReady(READY))
  })

  /**
   * Esta e a regressao que travou a aba do navegador.
   *
   * O seletor era `e.chamadas[id] ?? []`, e o `??` construia um array NOVO a
   * cada leitura. O zustand compara por identidade, concluia que o estado
   * mudou em todo render e reentrava para sempre. Nao aparecia em teste nenhum
   * porque nenhum teste montava o componente — so o navegador congelava.
   */
  it('monta sem entrar em laco de render quando ninguem esta na chamada', () => {
    render(<PainelDeVoz channelId={CANAL} nomeDoCanal="sala-de-voz" />)

    expect(screen.getByText(/Ninguem na chamada ainda/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entrar na chamada/ })).toBeInTheDocument()
  })

  it('lista quem ja esta na chamada, com o estado do microfone no rotulo', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'voice.participant_joined',
        d: { channelId: CANAL, userId: 'u2', microfone: true, camera: false, tela: false },
      })
    })

    render(<PainelDeVoz channelId={CANAL} nomeDoCanal="sala-de-voz" />)

    expect(screen.getByLabelText('Ana, microfone ligado')).toBeInTheDocument()
  })

  it('quem sai some da lista', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'voice.participant_joined',
        d: { channelId: CANAL, userId: 'u2', microfone: false, camera: false, tela: false },
      })
    })
    render(<PainelDeVoz channelId={CANAL} nomeDoCanal="sala-de-voz" />)
    expect(screen.getByLabelText('Ana, microfone desligado')).toBeInTheDocument()

    act(() => {
      useStore.getState().aplicarEvento({
        t: 'voice.participant_left',
        d: { channelId: CANAL, userId: 'u2' },
      })
    })
    expect(screen.queryByLabelText(/^Ana,/)).not.toBeInTheDocument()
  })

  it('trocar de canal nao deixa a chamada anterior de pe', () => {
    const enviar = vi.fn(() => true)
    act(() => useStore.getState().definirEnvio(enviar))
    const { unmount } = render(<PainelDeVoz channelId={CANAL} nomeDoCanal="sala-de-voz" />)

    // Desmontar precisa avisar a API que esta pessoa saiu: sem isso, o
    // microfone continuaria aberto num canal que a pessoa acha que deixou.
    unmount()
    expect(enviar).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'voice.leave' }),
    )
  })
})
