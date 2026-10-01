import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { RoomEvent } from 'livekit-client'
import {
  criarChamada, lerProcessamento, modeloDaSupressao, type Credencial, type SalaDeMidia,
} from '../src/lib/midia.js'
import { AnelDeFala } from '../src/ui/bits/AnelDeFala.js'
import { BarraDeChamada } from '../src/features/voice/BarraDeChamada.js'
import {
  plantarChamadaParaTeste, useChamadaAtiva, zerarChamadaParaTeste,
} from '../src/features/voice/chamadaAtiva.js'
import type { Chamada } from '../src/lib/midia.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

/**
 * A supressao de ruido por IA e o sinal verde de quem fala.
 *
 * A rede neural em si roda num AudioWorklet que o jsdom nao tem; o que se
 * prova aqui e o CONTRATO em volta dela — quando ela e plugada, quando sai,
 * e que uma falha nunca derruba o microfone.
 */

vi.mock('../src/lib/supressao.js', () => ({
  ModeloIndisponivel: class extends Error {},
  criarProcessadorDeVoz: (ajuste: { modelo: string | null }) => ({
    name: `falso-${String(ajuste.modelo)}`, ajustar: () => undefined,
  }),
  criarLimpezaDeEscuta: async () => ({ nos: [], desmontar: () => undefined }),
}))

describe('a preferencia de supressao', () => {
  beforeEach(() => { localStorage.clear() })

  it('quem nunca escolheu ganha a IA', () => {
    expect(lerProcessamento().supressao).toBe('ia')
  })

  it('quem tinha desligado a supressao antiga continua desligado', () => {
    // O formato anterior: um booleano do filtro do navegador. Quem desligou
    // de proposito — quem transmite musica — nao pode ser religado a forca.
    localStorage.setItem('altcast:processamento', JSON.stringify({ ruido: false, eco: true, ganho: false }))
    // E o portao tambem nao liga sozinho para ela: ele cortaria a nota que se
    // apaga devagar.
    expect(lerProcessamento()).toEqual({
      supressao: 'desligada', eco: true, ganho: false,
      intensidade: 100, portao: 'desligado', limiarDb: -50, nivelador: false, limparRecebido: false,
    })
  })

  it('valor desconhecido cai no padrão, e não quebra a tela', () => {
    localStorage.setItem('altcast:processamento', JSON.stringify({ supressao: 'krisp-pro' }))
    expect(lerProcessamento().supressao).toBe('ia')
  })

  it('cada modo de IA tem o seu modelo, e os outros nenhum', () => {
    expect(modeloDaSupressao('ia')).toBe('gtcrn')
    expect(modeloDaSupressao('ia-alta')).toBe('dfn3')
    expect(modeloDaSupressao('ia-leve')).toBe('rnnoise')
    expect(modeloDaSupressao('navegador')).toBeNull()
    expect(modeloDaSupressao('desligada')).toBeNull()
  })
})

const CREDENCIAL: Credencial = {
  url: 'ws://localhost:7880', token: 't', room: 'c1', identity: 'u1',
  expiresIn: 300, podePublicar: true, moderador: false, participants: [],
}

class SalaFalsa implements SalaDeMidia {
  private ouvintes = new Map<string, (...args: never[]) => void>()
  canPlaybackAudio = true
  localParticipant = {
    setMicrophoneEnabled: async (): Promise<unknown> => null,
    setCameraEnabled: async (): Promise<unknown> => null,
    setScreenShareEnabled: async (): Promise<unknown> => null,
  }
  async connect(): Promise<void> { /* conectado */ }
  async disconnect(): Promise<void> { /* fora */ }
  async switchActiveDevice(): Promise<unknown> { return null }
  async startAudio(): Promise<void> { /* destravado */ }
  on(evento: string, ouvinte: (...args: never[]) => void): unknown {
    this.ouvintes.set(evento, ouvinte)
    return this
  }
  emitir(evento: string, ...args: unknown[]): void {
    (this.ouvintes.get(evento) as ((...a: unknown[]) => void) | undefined)?.(...args)
  }
}

/** Um microfone publicado com a superficie de processador do LiveKit. */
function microfoneFalso(): {
  track: Record<string, unknown>
  restricoes: MediaTrackConstraints[]
  processadores: unknown[]
  parou: number
} {
  const registro = {
    track: {} as Record<string, unknown>,
    restricoes: [] as MediaTrackConstraints[],
    processadores: [] as unknown[],
    parou: 0,
  }
  let atual: unknown
  registro.track = {
    sid: 'TR_MIC',
    mediaStreamTrack: {
      applyConstraints: async (c: MediaTrackConstraints) => { registro.restricoes.push(c) },
    },
    setAudioContext: () => undefined,
    setProcessor: async (p: unknown) => { atual = p; registro.processadores.push(p) },
    stopProcessor: async () => { atual = undefined; registro.parou += 1 },
    getProcessor: () => atual,
  }
  return registro
}

const esperar = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}

describe('a supressao plugada no microfone', () => {
  const original = { AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode }

  beforeEach(() => {
    localStorage.clear()
    // O jsdom nao tem Web Audio. Um contexto falso basta: a rede de verdade
    // esta atras do `vi.mock` acima.
    ;(globalThis as Record<string, unknown>)['AudioContext'] = class {
      state = 'running'
      close(): Promise<void> { return Promise.resolve() }
    }
    ;(globalThis as Record<string, unknown>)['AudioWorkletNode'] = class {}
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>)['AudioContext'] = original.AudioContext
    ;(globalThis as Record<string, unknown>)['AudioWorkletNode'] = original.AudioWorkletNode
  })

  async function entrarComMicrofone(): Promise<{
    chamada: ReturnType<typeof criarChamada>
    mic: ReturnType<typeof microfoneFalso>
  }> {
    const sala = new SalaFalsa()
    const chamada = criarChamada({
      channelId: 'c1', enviar: () => true, aoMudar: () => undefined,
      criarSala: () => sala, listarSaidas: async () => [], obterCredencial: async () => CREDENCIAL,
    })
    await chamada.entrar()
    const mic = microfoneFalso()
    sala.emitir(RoomEvent.LocalTrackPublished, { kind: 'audio', source: 'microphone', track: mic.track })
    await esperar()
    return { chamada, mic }
  }

  it('ligar o microfone pluga a IA e tira o filtro do navegador do caminho', async () => {
    const { chamada, mic } = await entrarComMicrofone()

    expect(mic.processadores).toHaveLength(1)
    expect(mic.restricoes.at(-1)).toEqual({ noiseSuppression: false })
    expect(chamada.estado().supressaoAtiva).toBe(true)
  })

  it('trocar para o navegador no meio da chamada tira a IA e religa o filtro', async () => {
    const { chamada, mic } = await entrarComMicrofone()

    chamada.definirSupressao('navegador')
    await esperar()

    expect(mic.parou).toBe(1)
    expect(mic.restricoes.at(-1)).toEqual({ noiseSuppression: true })
    expect(chamada.estado().supressaoAtiva).toBe(false)
    // E a escolha fica para a proxima chamada.
    expect(lerProcessamento().supressao).toBe('navegador')
  })

  it('sem Web Audio no navegador a chamada segue, so que sem IA', async () => {
    ;(globalThis as Record<string, unknown>)['AudioWorkletNode'] = undefined
    const { chamada, mic } = await entrarComMicrofone()

    expect(mic.processadores).toHaveLength(0)
    expect(chamada.estado().supressaoAtiva).toBe(false)
    expect(chamada.estado().fase).toBe('dentro')
  })

  it('processador que falha não derruba o microfone', async () => {
    const sala = new SalaFalsa()
    const chamada = criarChamada({
      channelId: 'c1', enviar: () => true, aoMudar: () => undefined,
      criarSala: () => sala, listarSaidas: async () => [], obterCredencial: async () => CREDENCIAL,
    })
    await chamada.entrar()
    const mic = microfoneFalso()
    mic.track['setProcessor'] = async () => { throw new Error('wasm bloqueado pela CSP') }
    sala.emitir(RoomEvent.LocalTrackPublished, { kind: 'audio', source: 'microphone', track: mic.track })
    await esperar()

    expect(chamada.estado().supressaoAtiva).toBe(false)
    expect(chamada.estado().fase).toBe('dentro')
  })
})

describe('o anel verde de quem fala', () => {
  it('acende so enquanto a pessoa fala', () => {
    const { container, rerender } = render(
      <AnelDeFala falando={false}><span>foto</span></AnelDeFala>,
    )
    expect(container.querySelector('[data-falando="sim"]')).toBeNull()

    rerender(<AnelDeFala falando><span>foto</span></AnelDeFala>)
    const anel = container.querySelector('[data-falando="sim"]')
    expect(anel).not.toBeNull()
    expect(anel?.className).toContain('border-speaking')
  })
})

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Time', iconUrl: null, role: 'owner' }],
  channels: [{
    id: 'c-voz', groupId: 'g1', name: 'sala', type: 'voice',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [
    { groupId: 'g1', userId: 'u1', displayName: 'Felipe', avatarUrl: null, role: 'owner', status: 'online' },
    { groupId: 'g1', userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
  ],
  serverTime: '2026-09-29T12:00:00.000Z',
}

describe('a barra de chamada mostra fotos, e nao nomes piscando', () => {
  beforeEach(() => {
    zerarChamadaParaTeste()
    useStore.getState().limpar()
    act(() => {
      useStore.getState().aplicarReady(READY)
      useStore.getState().semearSala('c-voz', [
        { userId: 'u2', microfone: true, camera: false, tela: false },
      ])
    })
  })

  it('quem fala acende na foto, e o texto "falando" some da barra', () => {
    const nada = async (): Promise<void> => undefined
    act(() => {
      plantarChamadaParaTeste({
        entrar: nada, sair: nada, reanunciar: () => undefined, trocarDispositivo: nada,
        destravarAudio: nada, definirMicrofone: nada, definirCamera: nada, definirTela: nada,
        definirVolume: () => undefined, restaurarVolumes: () => undefined,
        definirQualidade: () => undefined, definirQualidadeDeRecepcao: () => undefined,
        definirSurdo: nada, definirSupressao: () => undefined, definirTratamento: () => undefined,
        estado: () => useChamadaAtiva.getState().chamada,
      } as Chamada, 'c-voz')
      useChamadaAtiva.setState(e => ({ chamada: { ...e.chamada, fase: 'dentro', falando: ['u2'] } }))
    })

    const { container } = render(<BarraDeChamada />)

    const lista = screen.getByRole('list', { name: 'Pessoas na chamada' })
    expect(lista).toBeInTheDocument()
    expect(screen.getByText('Ana, falando')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-falando="sim"]')).toHaveLength(1)
    expect(screen.queryByText(/Ana falando/)).not.toBeInTheDocument()
  })

  it('o botão de IA alterna a supressão direto da barra', () => {
    const definirSupressao = vi.fn()
    const nada = async (): Promise<void> => undefined
    act(() => {
      plantarChamadaParaTeste({
        entrar: nada, sair: nada, reanunciar: () => undefined, trocarDispositivo: nada,
        destravarAudio: nada, definirMicrofone: nada, definirCamera: nada, definirTela: nada,
        definirVolume: () => undefined, restaurarVolumes: () => undefined,
        definirQualidade: () => undefined, definirQualidadeDeRecepcao: () => undefined,
        definirSurdo: nada, definirSupressao, definirTratamento: () => undefined,
        estado: () => useChamadaAtiva.getState().chamada,
      } as Chamada, 'c-voz')
      useChamadaAtiva.setState(e => ({ chamada: { ...e.chamada, fase: 'dentro', supressao: 'ia' } }))
    })
    render(<BarraDeChamada />)

    act(() => { screen.getByRole('button', { name: 'Supressão de ruído por IA ligada' }).click() })
    expect(definirSupressao).toHaveBeenCalledWith('navegador')
  })
})
