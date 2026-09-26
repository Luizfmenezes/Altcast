import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useStore } from '../src/lib/store.js'
import type { Ready, SalaEmChamada } from '../src/lib/tipos.js'

/**
 * A cerca que faltava.
 *
 * O servidor sempre mandou `ready.calls` e o cliente sempre o descartou —
 * `Ready` nem declarava o campo. Quem ja estava numa chamada so aparecia para
 * quem chegava depois quando emitisse um evento novo por conta propria.
 *
 * Nenhum teste, nem aqui nem na API, afirmava que o `ready` carrega a sala. E
 * por isso o defeito sobreviveu a vinte e cinco suites.
 */

const GRUPO = 'g1'
const CANAL = 'c-voz'
const OUTRO_CANAL = 'c-voz-2'

const ANA = { userId: 'u2', microfone: true, camera: false, tela: false }
const CARLOS = { userId: 'u3', microfone: false, camera: false, tela: true }

function ready(calls?: SalaEmChamada[]): Ready {
  return {
    user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
    groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
    channels: [
      {
        id: CANAL, groupId: GRUPO, name: 'sala-de-voz', type: 'voice',
        visibility: 'public', topic: null, position: 0,
      },
      {
        id: OUTRO_CANAL, groupId: GRUPO, name: 'outra-sala', type: 'voice',
        visibility: 'public', topic: null, position: 1,
      },
    ],
    members: [{
      groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'owner', status: 'online',
    }],
    ...(calls === undefined ? {} : { calls }),
    serverTime: '2026-08-29T12:00:00.000Z',
  }
}

describe('a sala de voz que chega no ready', () => {
  beforeEach(() => { useStore.getState().limpar() })

  it('povoa o mapa de chamadas sem nenhum evento ter acontecido', () => {
    act(() => useStore.getState().aplicarReady(
      ready([{ channelId: CANAL, participants: [ANA, CARLOS] }]),
    ))

    expect(useStore.getState().chamadas[CANAL]).toEqual([ANA, CARLOS])
  })

  it('deixa vazio o canal de voz que o servidor omitiu', () => {
    act(() => useStore.getState().aplicarReady(
      ready([{ channelId: CANAL, participants: [ANA] }]),
    ))

    // Sala vazia nao vem no `ready`. Substituir o mapa inteiro faz o canal
    // ausente virar lista vazia sozinho — nao precisa de campo para isso.
    expect(useStore.getState().chamadas[OUTRO_CANAL]).toBeUndefined()
  })

  /**
   * ESTE e o teste que proibe o refactor errado.
   *
   * A tentacao, ao consertar "usuarios ocultos", e fundir o `ready` com o que
   * ja estava no mapa. Fundir troca o defeito por um pior: quem saiu da sala
   * enquanto a aba estava desconectada nunca mais sai da lista, e ninguem
   * percebe porque a tela mostra gente a mais, e nao gente a menos.
   */
  it('um ready posterior remove quem saiu enquanto a aba estava fora', () => {
    act(() => useStore.getState().aplicarReady(
      ready([{ channelId: CANAL, participants: [ANA, CARLOS] }]),
    ))
    expect(useStore.getState().chamadas[CANAL]).toHaveLength(2)

    // A aba reconectou e a sala esvaziou nesse meio tempo.
    act(() => useStore.getState().aplicarReady(ready([])))

    expect(useStore.getState().chamadas[CANAL]).toBeUndefined()
  })

  it('um ready sem o campo calls nao apaga o mapa', () => {
    act(() => useStore.getState().aplicarEvento({
      t: 'voice.participant_joined',
      d: { channelId: CANAL, ...ANA },
    }))
    expect(useStore.getState().chamadas[CANAL]).toEqual([ANA])

    // Servidor anterior a esta versao: campo ausente, e nao lista vazia. Uma
    // coisa e "a sala esvaziou", outra e "eu nao sei falar de salas".
    act(() => useStore.getState().aplicarReady(ready()))

    expect(useStore.getState().chamadas[CANAL]).toEqual([ANA])
  })

  it('a fotografia nao interfere no canal que ela nao menciona', () => {
    act(() => useStore.getState().aplicarReady(
      ready([
        { channelId: CANAL, participants: [ANA] },
        { channelId: OUTRO_CANAL, participants: [CARLOS] },
      ]),
    ))

    expect(useStore.getState().chamadas).toEqual({
      [CANAL]: [ANA],
      [OUTRO_CANAL]: [CARLOS],
    })
  })
})
