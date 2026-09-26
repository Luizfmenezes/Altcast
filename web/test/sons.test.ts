import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import {
  definirTocadorParaTeste, esquecerIntervaloParaTeste, guardarPreferenciaDeSons,
  lerPreferenciaDeSons, tocar, PREFERENCIA_PADRAO,
} from '../src/lib/sons.js'
import type { Cue } from '../src/lib/sons.js'
import { cueDeEvento } from '../src/features/voice/cues.js'
import { useStore } from '../src/lib/store.js'
import { useChamadaAtiva } from '../src/features/voice/chamadaAtiva.js'
import type { Ready } from '../src/lib/tipos.js'

/**
 * As deixas sonoras da chamada.
 *
 * O que se prova aqui e QUANDO o som sai, nunca como ele soa. O emissor e
 * injetavel pela mesma razao que a sala de midia: um teste nao pode depender
 * de um `AudioContext` de verdade, e a unica pergunta que importa — "tocou no
 * momento certo?" — nao precisa de um.
 */

const CANAL = 'c-voz'
const OUTRO = 'c-voz-2'
const EU = 'u1'
const ANA = 'u2'

const ouvidos: Cue[] = []

const READY: Ready = {
  user: { id: EU, displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: CANAL, groupId: 'g1', name: 'sala', type: 'voice',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [],
  serverTime: '2026-09-25T12:00:00.000Z',
}

function naChamada(canal: string | null, surdo = false): void {
  act(() => {
    useChamadaAtiva.setState(e => ({
      canal,
      chamada: { ...e.chamada, fase: canal === null ? 'fora' : 'dentro', surdo },
    }))
  })
}

describe('o modulo de sons', () => {
  beforeEach(() => {
    ouvidos.length = 0
    window.localStorage.clear()
    definirTocadorParaTeste({ tocar: c => { ouvidos.push(c) } })
  })

  afterEach(() => { definirTocadorParaTeste(null) })

  it('toca a deixa pedida', () => {
    tocar('entrei')
    expect(ouvidos).toEqual(['entrei'])
  })

  /**
   * A tecla `M` repete enquanto segurada, e uma rajada de chegadas acontece
   * quando um grupo entra junto numa reuniao. Sem limite, os dois viram ruido.
   */
  it('duas deixas iguais coladas viram uma', () => {
    tocar('mudo')
    tocar('mudo')
    expect(ouvidos).toEqual(['mudo'])
  })

  it('deixas diferentes nao se atrapalham', () => {
    tocar('mudo')
    tocar('desmudo')
    expect(ouvidos).toEqual(['mudo', 'desmudo'])
  })

  it('desligado nos ajustes, nada sai', () => {
    guardarPreferenciaDeSons({ ligado: false, volume: 0.5 })
    esquecerIntervaloParaTeste()
    tocar('entrei')
    expect(ouvidos).toEqual([])
  })

  it('sem AudioContext nenhum, nao lanca', () => {
    definirTocadorParaTeste(null)
    vi.stubGlobal('AudioContext', undefined)
    expect(() => tocar('entrei')).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('preferencia corrompida cai no padrao', () => {
    window.localStorage.setItem('altcast:sons', 'nao e json')
    expect(lerPreferenciaDeSons()).toEqual(PREFERENCIA_PADRAO)
  })
})

describe('as deixas de quem chega e sai', () => {
  beforeEach(() => {
    ouvidos.length = 0
    window.localStorage.clear()
    definirTocadorParaTeste({ tocar: c => { ouvidos.push(c) } })
    useStore.getState().limpar()
    act(() => useStore.getState().aplicarReady(READY))
    naChamada(CANAL)
  })

  afterEach(() => {
    definirTocadorParaTeste(null)
    naChamada(null)
  })

  it('outra pessoa entrando na minha sala toca', () => {
    cueDeEvento({ t: 'voice.participant_joined', d: { channelId: CANAL, userId: ANA } })
    expect(ouvidos).toEqual(['alguem-entrou'])
  })

  it('outra pessoa saindo da minha sala toca', () => {
    cueDeEvento({ t: 'voice.participant_left', d: { channelId: CANAL, userId: ANA } })
    expect(ouvidos).toEqual(['alguem-saiu'])
  })

  /**
   * O servidor ecoa a minha propria entrada para mim — `emit.toChannel` nao
   * filtra o autor. Sem esta guarda, entrar numa chamada tocaria dois sons: o
   * meu, local, e o eco.
   */
  it('o eco da minha propria entrada nao toca', () => {
    cueDeEvento({ t: 'voice.participant_joined', d: { channelId: CANAL, userId: EU } })
    expect(ouvidos).toEqual([])
  })

  it('sala que eu so estou olhando nao apita', () => {
    cueDeEvento({ t: 'voice.participant_joined', d: { channelId: OUTRO, userId: ANA } })
    expect(ouvidos).toEqual([])
  })

  it('surdo cala a chegada alheia', () => {
    naChamada(CANAL, true)
    cueDeEvento({ t: 'voice.participant_joined', d: { channelId: CANAL, userId: ANA } })
    expect(ouvidos).toEqual([])
  })

  /**
   * `track_published` dispara a cada vez que QUALQUER pessoa liga ou desliga
   * microfone, camera ou tela. Uma sala de oito pessoas conversando viraria
   * uma metralhadora.
   */
  it('ligar camera de alguem nao e uma chegada', () => {
    cueDeEvento({
      t: 'voice.track_published',
      d: { channelId: CANAL, userId: ANA, camera: true, microfone: true, tela: false },
    })
    expect(ouvidos).toEqual([])
  })

  /**
   * A BARREIRA.
   *
   * A fotografia do `ready` traz a sala ja povoada — e cinco pessoas ja na
   * sala nao sao cinco chegadas. Sao tres defesas somadas: a store nao importa
   * o modulo de sons, `cueDeEvento` so reconhece dois tipos de evento, e este
   * teste. Sem ele, alguem "simplifica" movendo a deixa para dentro da store e
   * entrega cinco bipes no login.
   */
  it('um ready com a sala cheia e completamente mudo', () => {
    act(() => useStore.getState().aplicarReady({
      ...READY,
      calls: [{
        channelId: CANAL,
        participants: ['u2', 'u3', 'u4', 'u5', 'u6'].map(userId => ({
          userId, microfone: true, camera: false, tela: false,
        })),
      }],
    }))

    expect(useStore.getState().chamadas[CANAL]).toHaveLength(5)
    expect(ouvidos).toEqual([])
  })
})
