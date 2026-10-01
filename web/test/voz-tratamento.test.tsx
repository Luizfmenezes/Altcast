import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { RoomEvent } from 'livekit-client'
import {
  criarChamada, guardarProcessamento, lerProcessamento, precisaDeCadeia, PROCESSAMENTO_PADRAO,
  type Credencial, type SalaDeMidia,
} from '../src/lib/midia.js'
import { PreferenciasDeMidia } from '../src/features/voice/ConfiguracaoDeMidia.js'
import { useChamadaAtiva, zerarChamadaParaTeste } from '../src/features/voice/chamadaAtiva.js'

/**
 * O tratamento da voz alem da supressao: intensidade, sensibilidade de
 * entrada, nivelador, a "alta qualidade" com plano B e a limpeza do que chega.
 *
 * A cadeia de Web Audio e falsa (jsdom nao tem AudioWorklet); o que se prova e
 * o contrato: o que e plugado, quando, e o que sobrevive a cada falha.
 */

const falso = vi.hoisted(() => ({
  falharDfn3: false,
  criados: [] as { modelo: string | null; ajustes: unknown[] }[],
  limpezas: [] as { desmontado: boolean }[],
}))

vi.mock('../src/lib/supressao.js', () => {
  class ModeloIndisponivel extends Error {}
  return {
    ModeloIndisponivel,
    criarProcessadorDeVoz: (ajuste: { modelo: string | null }) => {
      if (ajuste.modelo === 'dfn3' && falso.falharDfn3) throw new ModeloIndisponivel('dfn3')
      const criado = { modelo: ajuste.modelo, ajustes: [] as unknown[] }
      falso.criados.push(criado)
      return {
        name: `falso-${String(ajuste.modelo)}`,
        ajustar: (m: unknown) => { criado.ajustes.push(m) },
      }
    },
    criarLimpezaDeEscuta: async () => {
      const limpeza = { desmontado: false }
      falso.limpezas.push(limpeza)
      return { nos: ['no-da-rede'], desmontar: () => { limpeza.desmontado = true } }
    },
  }
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

function microfoneFalso(): { track: Record<string, unknown>; processadores: unknown[]; parou: number } {
  const registro = { track: {} as Record<string, unknown>, processadores: [] as unknown[], parou: 0 }
  let atual: unknown
  registro.track = {
    sid: 'TR_MIC',
    mediaStreamTrack: { applyConstraints: async () => undefined },
    setAudioContext: () => undefined,
    setProcessor: async (p: unknown) => { atual = p; registro.processadores.push(p) },
    stopProcessor: async () => { atual = undefined; registro.parou += 1 },
    getProcessor: () => atual,
  }
  return registro
}

/** Uma faixa remota de audio com a superficie de Web Audio do LiveKit. */
function faixaRemota(sid: string): {
  track: Record<string, unknown>
  elemento: { muted: boolean; volume: number }
  plugins: unknown[][]
  contextos: unknown[]
} {
  const registro = {
    track: {} as Record<string, unknown>,
    elemento: { muted: false, volume: 1 },
    plugins: [] as unknown[][],
    contextos: [] as unknown[],
  }
  registro.track = {
    sid,
    kind: 'audio',
    attachedElements: [registro.elemento],
    setAudioContext: (c: unknown) => { registro.contextos.push(c) },
    setWebAudioPlugins: (nos: unknown[]) => { registro.plugins.push(nos) },
    setVolume: (v: number) => { registro.elemento.volume = v },
  }
  return registro
}

const esperar = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}

const original = { AudioContext: globalThis.AudioContext, AudioWorkletNode: globalThis.AudioWorkletNode }

beforeEach(() => {
  localStorage.clear()
  falso.falharDfn3 = false
  falso.criados.length = 0
  falso.limpezas.length = 0
  ;(globalThis as Record<string, unknown>)['AudioContext'] = class {
    state = 'running'
    close(): Promise<void> { return Promise.resolve() }
    resume(): Promise<void> { return Promise.resolve() }
  }
  ;(globalThis as Record<string, unknown>)['AudioWorkletNode'] = class {}
})

afterEach(() => {
  ;(globalThis as Record<string, unknown>)['AudioContext'] = original.AudioContext
  ;(globalThis as Record<string, unknown>)['AudioWorkletNode'] = original.AudioWorkletNode
})

async function entrar(): Promise<{ chamada: ReturnType<typeof criarChamada>; sala: SalaFalsa }> {
  const sala = new SalaFalsa()
  const chamada = criarChamada({
    channelId: 'c1', enviar: () => true, aoMudar: () => undefined,
    criarSala: () => sala, listarSaidas: async () => [], obterCredencial: async () => CREDENCIAL,
  })
  await chamada.entrar()
  return { chamada, sala }
}

async function publicarMicrofone(sala: SalaFalsa): Promise<ReturnType<typeof microfoneFalso>> {
  const mic = microfoneFalso()
  sala.emitir(RoomEvent.LocalTrackPublished, { kind: 'audio', source: 'microphone', track: mic.track })
  await esperar()
  return mic
}

describe('as preferencias novas', () => {
  it('quem nunca mexeu ganha portao automatico, intensidade cheia e o resto desligado', () => {
    expect(lerProcessamento()).toEqual(PROCESSAMENTO_PADRAO)
    expect(PROCESSAMENTO_PADRAO).toMatchObject({
      intensidade: 100, portao: 'automatico', nivelador: false, limparRecebido: false,
    })
  })

  it('valores fora da faixa sao trazidos para dentro, e nao quebram a tela', () => {
    localStorage.setItem('altcast:processamento', JSON.stringify({
      supressao: 'ia', intensidade: 180, limiarDb: -400, portao: 'sempre', nivelador: 'sim',
    }))
    expect(lerProcessamento()).toMatchObject({
      intensidade: 100, limiarDb: -100, portao: 'automatico', nivelador: false,
    })
  })

  it('sem rede, sem portao e sem nivelador o microfone vai cru', () => {
    const cru = { ...PROCESSAMENTO_PADRAO, supressao: 'desligada' as const, portao: 'desligado' as const }
    expect(precisaDeCadeia(cru)).toBe(false)
    expect(precisaDeCadeia({ ...cru, nivelador: true })).toBe(true)
    expect(precisaDeCadeia({ ...cru, portao: 'manual' })).toBe(true)
  })
})

describe('a cadeia na chamada', () => {
  it('sem IA, o portao automatico ainda pluga a cadeia — so que sem rede', async () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, supressao: 'navegador' })
    const { chamada, sala } = await entrar()
    const mic = await publicarMicrofone(sala)

    expect(mic.processadores).toHaveLength(1)
    expect(falso.criados.at(-1)?.modelo).toBeNull()
    expect(chamada.estado().supressaoAtiva).toBe(false)
  })

  it('a intensidade muda na hora, por mensagem, sem replugar o microfone', async () => {
    const { chamada, sala } = await entrar()
    const mic = await publicarMicrofone(sala)

    chamada.definirTratamento({ intensidade: 60 })
    await esperar()

    expect(mic.processadores).toHaveLength(1)
    expect(mic.parou).toBe(0)
    expect(falso.criados[0]?.ajustes.at(-1)).toMatchObject({ intensidade: 60 })
    expect(lerProcessamento().intensidade).toBe(60)
  })

  it('tirar o ultimo motivo da cadeia tira o processador', async () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, supressao: 'desligada', portao: 'manual' })
    const { chamada, sala } = await entrar()
    const mic = await publicarMicrofone(sala)
    expect(mic.processadores).toHaveLength(1)

    chamada.definirTratamento({ portao: 'desligado' })
    await esperar()

    expect(mic.parou).toBe(1)
    expect(mic.processadores).toHaveLength(1)
  })

  it('a alta qualidade que falta no servidor cai para a IA padrao, e diz isso', async () => {
    falso.falharDfn3 = true
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, supressao: 'ia-alta' })
    const { chamada, sala } = await entrar()
    await publicarMicrofone(sala)

    expect(chamada.estado().supressaoAtiva).toBe(true)
    expect(chamada.estado().modeloAtivo).toBe('gtcrn')
    expect(chamada.estado().supressao).toBe('ia-alta')
  })
})

describe('a limpeza do audio que chega', () => {
  function inscrever(sala: SalaFalsa, faixa: ReturnType<typeof faixaRemota>, fonte = 'microphone'): void {
    sala.emitir(
      RoomEvent.TrackSubscribed,
      faixa.track,
      { kind: 'audio', source: fonte, trackSid: faixa.track['sid'] },
      { identity: 'u2' },
    )
  }

  it('desligada (o padrao), ninguem e tocado', async () => {
    const { sala } = await entrar()
    const ana = faixaRemota('TR_ANA')
    inscrever(sala, ana)
    await esperar()
    expect(ana.plugins).toHaveLength(0)
  })

  it('ligada, pluga uma rede no microfone de quem chega e cala o <audio> cru', async () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, limparRecebido: true })
    const { sala } = await entrar()
    const ana = faixaRemota('TR_ANA')
    inscrever(sala, ana)
    await esperar()

    expect(ana.plugins.at(-1)).toEqual(['no-da-rede'])
    expect(ana.contextos).toHaveLength(1)
    expect(ana.elemento.muted).toBe(true)
  })

  it('o som de tela compartilhada fica intacto: musica nao e ruido', async () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, limparRecebido: true })
    const { sala } = await entrar()
    const tela = faixaRemota('TR_TELA')
    inscrever(sala, tela, 'screen_share_audio')
    await esperar()
    expect(tela.plugins).toHaveLength(0)
  })

  it('desligar no meio da chamada devolve o <audio> e solta a rede', async () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, limparRecebido: true })
    const { chamada, sala } = await entrar()
    const ana = faixaRemota('TR_ANA')
    inscrever(sala, ana)
    await esperar()

    chamada.definirTratamento({ limparRecebido: false })
    await esperar()

    expect(ana.plugins.at(-1)).toEqual([])
    expect(ana.contextos.at(-1)).toBeUndefined()
    expect(ana.elemento.muted).toBe(false)
    expect(ana.elemento.volume).toBe(1)
    expect(falso.limpezas[0]?.desmontado).toBe(true)
  })

  it('ligar no meio da chamada limpa quem ja estava', async () => {
    const { chamada, sala } = await entrar()
    const ana = faixaRemota('TR_ANA')
    inscrever(sala, ana)
    await esperar()
    expect(ana.plugins).toHaveLength(0)

    chamada.definirTratamento({ limparRecebido: true })
    await esperar()
    expect(ana.plugins.at(-1)).toEqual(['no-da-rede'])
  })
})

describe('a tela de tratamento', () => {
  beforeEach(() => { zerarChamadaParaTeste() })

  it('mostra a alta qualidade, a intensidade e guarda o que muda', () => {
    render(<PreferenciasDeMidia />)
    expect(screen.getByRole('radio', { name: /IA alta qualidade/ })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: /Intensidade da limpeza/ }), {
      target: { value: '70' },
    })
    expect(lerProcessamento().intensidade).toBe(70)
  })

  it('a intensidade some sem IA: nao ha limpeza para dosar', () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, supressao: 'navegador' })
    render(<PreferenciasDeMidia />)
    expect(screen.queryByRole('slider', { name: /Intensidade da limpeza/ })).not.toBeInTheDocument()
  })

  it('o limiar manual aparece so no modo manual', () => {
    render(<PreferenciasDeMidia />)
    expect(screen.queryByRole('slider', { name: /Limiar/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }))
    expect(lerProcessamento().portao).toBe('manual')
    fireEvent.change(screen.getByRole('slider', { name: /Limiar/ }), { target: { value: '-35' } })
    expect(lerProcessamento().limiarDb).toBe(-35)
  })

  it('nivelador e limpeza do que chega viram preferencia', () => {
    render(<PreferenciasDeMidia />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Nivelador de voz/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Limpar o áudio de quem chega/ }))
    expect(lerProcessamento()).toMatchObject({ nivelador: true, limparRecebido: true })
  })

  it('avisa quando a alta qualidade caiu para a IA padrao', () => {
    guardarProcessamento({ ...PROCESSAMENTO_PADRAO, supressao: 'ia-alta' })
    act(() => {
      useChamadaAtiva.setState(e => ({
        chamada: {
          ...e.chamada, fase: 'dentro', supressao: 'ia-alta', supressaoAtiva: true, modeloAtivo: 'gtcrn',
        },
      }))
    })
    render(<PreferenciasDeMidia />)
    expect(screen.getByRole('status')).toHaveTextContent(/alta qualidade não está disponível/)
  })

  it('o medidor da sensibilidade diz se esta transmitindo', () => {
    act(() => {
      useChamadaAtiva.setState(e => ({
        chamada: {
          ...e.chamada, fase: 'dentro',
          medidaDaVoz: { nivelDb: -62, limiarDb: -48, aberto: false, atraso: null },
        },
      }))
    })
    render(<PreferenciasDeMidia />)
    const medidor = screen.getByRole('meter', { name: /Nível da voz contra o limiar/ })
    expect(medidor).toHaveAttribute('aria-valuetext', '-62 dB, microfone fechado')
  })

  it('sem gravador no navegador, o teste de microfone explica em vez de quebrar', () => {
    render(<PreferenciasDeMidia />)
    expect(screen.getByText(/não consegue gravar o teste de microfone/)).toBeInTheDocument()
  })
})
