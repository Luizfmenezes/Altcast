import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { BarraDeChamada } from '../src/features/voice/BarraDeChamada.js'
import {
  plantarChamadaParaTeste, registrarSaidaDaAba, useChamadaAtiva, zerarChamadaParaTeste,
} from '../src/features/voice/chamadaAtiva.js'
import type { Chamada } from '../src/lib/midia.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

/**
 * A chamada que sobrevive a navegacao.
 *
 * O que estes testes protegem nao e o ganho — esse e obvio — e sim o PRECO. A
 * decisao antiga derrubava a chamada no desmonte, e isso garantia, por
 * acidente, que ninguem ficasse com o microfone aberto sem saber. Ao remover
 * essa garantia, tres outras precisam existir no lugar dela, e sao elas que
 * estao aqui.
 */

const GRUPO = 'g1'
const VOZ_A = 'c-voz-a'
const VOZ_B = 'c-voz-b'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [
    {
      id: VOZ_A, groupId: GRUPO, name: 'sala-a', type: 'voice',
      visibility: 'public', topic: null, position: 0,
    },
    {
      id: VOZ_B, groupId: GRUPO, name: 'sala-b', type: 'voice',
      visibility: 'public', topic: null, position: 1,
    },
  ],
  members: [{
    groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
    avatarUrl: null, role: 'owner', status: 'online',
  }],
  serverTime: '2026-08-30T12:00:00.000Z',
}

/**
 * Entrar de verdade exigiria um SFU. O que estes testes precisam provar e o
 * CICLO DE VIDA — quem derruba quem, e quando —, entao entra em cena um duble.
 * A negociacao de midia ja esta provada em `midia.test.ts`, contra uma sala
 * falsa; repeti-la aqui nao acrescentaria nada.
 */
function chamadaDuble(): Chamada & { sair: ReturnType<typeof vi.fn> } {
  const nada = async (): Promise<void> => undefined
  return {
    entrar: nada,
    sair: vi.fn(nada),
    trocarDispositivo: nada,
    destravarAudio: nada,
    definirMicrofone: nada,
    definirCamera: nada,
    definirTela: nada,
    definirVolume: () => undefined,
    restaurarVolumes: () => undefined,
    definirQualidade: () => undefined,
    definirQualidadeDeRecepcao: () => undefined,
    definirSurdo: nada,
    estado: () => useChamadaAtiva.getState().chamada,
  } as Chamada & { sair: ReturnType<typeof vi.fn> }
}

function fingirChamadaEm(
  channelId: string, microfone = false,
): ReturnType<typeof chamadaDuble> {
  const duble = chamadaDuble()
  act(() => {
    plantarChamadaParaTeste(duble, channelId)
    useChamadaAtiva.setState(e => ({
      chamada: { ...e.chamada, fase: 'dentro', microfone },
    }))
  })
  return duble
}

describe('a chamada acima da arvore de componentes', () => {
  beforeEach(() => {
    zerarChamadaParaTeste()
    useStore.getState().limpar()
    act(() => {
      useStore.getState().aplicarReady(READY)
      useStore.getState().escolherCanal(VOZ_A)
    })
  })

  it('sem chamada nenhuma a barra nao ocupa espaco', () => {
    render(<BarraDeChamada />)
    expect(screen.queryByLabelText('Chamada em curso')).not.toBeInTheDocument()
  })

  it('trocar de canal MANTEM a chamada', () => {
    fingirChamadaEm(VOZ_A)
    render(<BarraDeChamada />)

    act(() => { useStore.getState().escolherCanal(VOZ_B) })

    // O ganho da fase inteira: ler outro canal deixou de custar a conversa.
    expect(useChamadaAtiva.getState().canal).toBe(VOZ_A)
    expect(screen.getByLabelText('Chamada em curso')).toBeInTheDocument()
  })

  it('a barra mostra o microfone em qualquer tela, e nao so no canal da chamada', () => {
    fingirChamadaEm(VOZ_A, true)
    act(() => { useStore.getState().escolherCanal(VOZ_B) })
    render(<BarraDeChamada />)

    // Esta e a garantia que substitui o desmonte: um microfone aberto fica
    // visivel o tempo todo, em vez de depender de a pessoa estar olhando o
    // canal certo.
    expect(screen.getByRole('button', { name: 'Microfone ligado' })).toHaveAttribute(
      'aria-pressed', 'true',
    )
  })

  it('a barra leva de volta ao canal da chamada', async () => {
    fingirChamadaEm(VOZ_A)
    act(() => { useStore.getState().escolherCanal(VOZ_B) })
    render(<BarraDeChamada />)

    await act(async () => {
      screen.getByRole('button', { name: /Na chamada/ }).click()
    })

    // Obrigar a procurar o canal na lista desfaria metade do ganho de a
    // chamada ter sobrevivido a navegacao.
    expect(useStore.getState().canalAtivo).toBe(VOZ_A)
  })

  it('entrar num segundo canal de voz derruba a chamada do primeiro', async () => {
    const primeira = fingirChamadaEm(VOZ_A)

    // A entrada em VOZ_B falha sem SFU, e nao importa: o que precisa ser
    // provado e que a anterior foi derrubada ANTES da tentativa. Duas salas
    // abertas mandariam o microfone para um canal que a pessoa acha que deixou.
    await act(async () => {
      await useChamadaAtiva.getState().entrar(VOZ_B).catch(() => undefined)
    })

    expect(primeira.sair).toHaveBeenCalled()
  })

  it('entrar de novo no MESMO canal nao reabre a sala', async () => {
    const atual = fingirChamadaEm(VOZ_A)

    await act(async () => {
      await useChamadaAtiva.getState().entrar(VOZ_A).catch(() => undefined)
    })

    // Reentrar abriria uma segunda sala para o mesmo canal e mandaria o audio
    // duas vezes.
    expect(atual.sair).not.toHaveBeenCalled()
    expect(useChamadaAtiva.getState().canal).toBe(VOZ_A)
  })

  it('fechar a aba derruba a chamada', () => {
    const duble = fingirChamadaEm(VOZ_A)
    const soltar = registrarSaidaDaAba()

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    // O unico caso em que nenhuma interface pode avisar, porque nao ha mais
    // interface nenhuma. Sem isto o microfone ficaria aberto no SFU ate o
    // tempo de saida do servidor expirar.
    expect(useChamadaAtiva.getState().canal).toBeNull()
    expect(duble.sair).toHaveBeenCalled()
    soltar()
  })

  it('sair pela barra encerra a chamada', async () => {
    fingirChamadaEm(VOZ_A)
    render(<BarraDeChamada />)

    await act(async () => {
      screen.getByRole('button', { name: /Sair da chamada/ }).click()
    })

    expect(useChamadaAtiva.getState().canal).toBeNull()
    expect(screen.queryByLabelText('Chamada em curso')).not.toBeInTheDocument()
  })
})
