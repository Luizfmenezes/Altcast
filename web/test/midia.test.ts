import { describe, it, expect, vi } from 'vitest'
import { RoomEvent } from 'livekit-client'
import { criarChamada, type Credencial, type SalaDeMidia } from '../src/lib/midia.js'

const CREDENCIAL: Credencial = {
  url: 'ws://localhost:7880', token: 'token-falso', room: 'c1', identity: 'u1',
  expiresIn: 300, podePublicar: true, moderador: false, participants: [],
}

/**
 * Sala falsa com a mesma superficie que `midia.ts` usa. Ela existe para que
 * estes testes provem o CONTRATO — a ordem dos anuncios, o que acontece quando
 * a conexao falha — sem depender de um SFU de pe.
 */
class SalaFalsa implements SalaDeMidia {
  conectadaEm: string | null = null
  desconectou = false
  falharAoConectar = false
  falharDispositivo = false
  chamadas: string[] = []
  trocados: string[] = []
  falharTroca = false
  /** O que `setScreenShareEnabled` recebeu como segundo argumento. */
  opcoesDaTela: unknown = undefined
  /** Quantas vezes o gesto da pessoa destravou o audio. */
  destravou = 0
  canPlaybackAudio = true

  private ouvintes = new Map<string, (...args: never[]) => void>()

  async switchActiveDevice(tipo: string, deviceId: string): Promise<unknown> {
    if (this.falharTroca) throw new Error('dispositivo indisponivel')
    this.trocados.push(`${tipo}:${deviceId}`)
    return null
  }

  localParticipant = {
    setMicrophoneEnabled: (v: boolean): Promise<unknown> => this.dispositivo('mic', v),
    setCameraEnabled: (v: boolean): Promise<unknown> => this.dispositivo('cam', v),
    setScreenShareEnabled: (v: boolean, opcoes?: unknown): Promise<unknown> => {
      this.opcoesDaTela = opcoes
      return this.dispositivo('tela', v)
    },
  }

  async startAudio(): Promise<void> {
    this.destravou += 1
    this.canPlaybackAudio = true
  }

  private async dispositivo(qual: string, v: boolean): Promise<unknown> {
    if (this.falharDispositivo) throw new Error('permissao negada')
    this.chamadas.push(`${qual}:${String(v)}`)
    return null
  }

  async connect(url: string): Promise<void> {
    if (this.falharAoConectar) throw new Error('sem SFU')
    this.conectadaEm = url
  }

  async disconnect(): Promise<void> {
    this.desconectou = true
  }

  on(evento: string, ouvinte: (...args: never[]) => void): unknown {
    this.ouvintes.set(evento, ouvinte)
    return this
  }

  /** Dispara um evento do SFU como o LiveKit dispararia. */
  emitir(evento: string, ...args: unknown[]): void {
    const ouvinte = this.ouvintes.get(evento) as ((...a: unknown[]) => void) | undefined
    ouvinte?.(...args)
  }
}

type Quadro = { t: string; d?: unknown }

function montar(opcoes: { credencial?: Credencial; erroDaCredencial?: unknown } = {}): {
  chamada: ReturnType<typeof criarChamada>
  sala: SalaFalsa
  enviados: Quadro[]
} {
  const sala = new SalaFalsa()
  const enviados: Quadro[] = []

  const chamada = criarChamada({
    channelId: 'c1',
    enviar: quadro => {
      enviados.push(quadro)
      return true
    },
    aoMudar: () => undefined,
    criarSala: () => sala,
    obterCredencial: async () => {
      if (opcoes.erroDaCredencial !== undefined) throw opcoes.erroDaCredencial
      return opcoes.credencial ?? CREDENCIAL
    },
  })

  return { chamada, sala, enviados }
}

const tipos = (enviados: Quadro[]): string[] => enviados.map(q => q.t)

describe('entrada na chamada', () => {
  it('conecta ao SFU e so entao anuncia a entrada a API', async () => {
    const { chamada, sala, enviados } = montar()
    await chamada.entrar()

    expect(sala.conectadaEm).toBe('ws://localhost:7880')
    expect(chamada.estado().fase).toBe('dentro')
    // A ordem e a regra: anunciar antes de conectar mostraria na sala alguem
    // que ainda pode falhar ao entrar.
    expect(tipos(enviados)).toEqual(['voice.join'])
  })

  it('servidor de midia ausente vira uma frase que explica o que houve', async () => {
    const { chamada, enviados } = montar({ erroDaCredencial: { code: 'media_unavailable' } })
    await chamada.entrar()

    expect(chamada.estado().fase).toBe('erro')
    expect(chamada.estado().erro).toContain('nao esta configurado')
    // Ninguem entrou: a API nao pode ouvir um join que nao aconteceu.
    expect(enviados).toEqual([])
  })

  it('falha de conexao com o SFU nao anuncia entrada nenhuma', async () => {
    const { chamada, sala, enviados } = montar()
    sala.falharAoConectar = true
    await chamada.entrar()

    expect(chamada.estado().fase).toBe('erro')
    expect(enviados).toEqual([])
  })

  it('entrar duas vezes nao abre duas salas', async () => {
    const { chamada, enviados } = montar()
    await chamada.entrar()
    await chamada.entrar()

    expect(tipos(enviados)).toEqual(['voice.join'])
  })
})

describe('o que a pessoa transmite', () => {
  it('liga o microfone e anuncia o estado a API', async () => {
    const { chamada, sala, enviados } = montar()
    await chamada.entrar()
    await chamada.definirMicrofone(true)

    expect(sala.chamadas).toContain('mic:true')
    expect(chamada.estado().microfone).toBe(true)
    expect(enviados.at(-1)).toEqual({
      t: 'voice.state',
      d: { channelId: 'c1', microfone: true, camera: false, tela: false },
    })
  })

  it('quem nao pode publicar nao liga o microfone nem por engano', async () => {
    const { chamada, sala, enviados } = montar({
      credencial: { ...CREDENCIAL, podePublicar: false },
    })
    await chamada.entrar()
    await chamada.definirMicrofone(true)

    expect(sala.chamadas).toEqual([])
    expect(chamada.estado().microfone).toBe(false)
    expect(tipos(enviados)).toEqual(['voice.join'])
  })

  it('permissao negada pelo navegador nao marca o microfone como ligado', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.falharDispositivo = true
    await chamada.definirMicrofone(true)

    // O botao precisa voltar sozinho, e nao mentir que ligou.
    expect(chamada.estado().microfone).toBe(false)
    expect(chamada.estado().erro).toContain('nao liberou o dispositivo')
  })
})

describe('faixas que chegam do SFU', () => {
  const publicacaoDeVideo = { kind: 'video', source: 'camera' }
  const faixa = { sid: 'TR_1' }

  it('faixa assinada aparece com o dono certo', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.TrackSubscribed, faixa, publicacaoDeVideo, { identity: 'u2' })

    expect(chamada.estado().faixas).toHaveLength(1)
    expect(chamada.estado().faixas[0]).toMatchObject({ userId: 'u2', papel: 'camera' })
  })

  it('faixa de fonte desconhecida e ignorada em vez de virar quadrado vazio', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(
      RoomEvent.TrackSubscribed, faixa, { kind: 'video', source: 'inventada' },
      { identity: 'u2' },
    )

    expect(chamada.estado().faixas).toEqual([])
  })

  it('quem sai da sala nao deixa o ultimo quadro congelado na tela', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.TrackSubscribed, faixa, publicacaoDeVideo, { identity: 'u2' })
    sala.emitir(RoomEvent.ParticipantDisconnected, { identity: 'u2' })

    expect(chamada.estado().faixas).toEqual([])
  })

  it('a propria camera aparece para o dono, e nao so para a sala', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.LocalTrackPublished, {
      kind: 'video', source: 'camera', track: { sid: 'TR_LOCAL' },
    })

    // Sem isto, quem liga a camera olha para um retangulo vazio e nao sabe se
    // o dispositivo certo foi escolhido — a sala ve, e so o dono nao ve.
    expect(chamada.estado().faixas).toMatchObject([
      { userId: 'u1', papel: 'camera', local: true },
    ])
  })

  it('o proprio audio nunca vira faixa: reproduzi-lo seria eco', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.LocalTrackPublished, {
      kind: 'audio', source: 'microphone', track: { sid: 'TR_MIC' },
    })

    expect(chamada.estado().faixas).toEqual([])
  })

  it('desligar a camera tira a propria faixa da tela', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    const publicacao = { kind: 'video', source: 'camera', track: { sid: 'TR_LOCAL' } }
    sala.emitir(RoomEvent.LocalTrackPublished, publicacao)
    expect(chamada.estado().faixas).toHaveLength(1)

    sala.emitir(RoomEvent.LocalTrackUnpublished, publicacao)
    expect(chamada.estado().faixas).toEqual([])
  })

  it('queda do proprio SFU avisa a API que esta pessoa saiu', async () => {
    const { chamada, sala, enviados } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.Disconnected)

    expect(tipos(enviados)).toEqual(['voice.join', 'voice.leave'])
    expect(chamada.estado().fase).toBe('fora')
  })
})

describe('escolha de dispositivo', () => {
  it('troca o microfone em chamada e guarda a escolha para a proxima', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.trocarDispositivo('audioinput', 'mic-usb')

    expect(sala.trocados).toEqual(['audioinput:mic-usb'])
    expect(JSON.parse(localStorage.getItem('altcast:dispositivos') ?? '{}'))
      .toMatchObject({ audioinput: 'mic-usb' })
  })

  it('escolher fora da chamada guarda a preferencia sem estourar', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.trocarDispositivo('audiooutput', 'fone')

    // Nao ha sala para trocar, mas a escolha nao pode se perder: ela vale na
    // proxima entrada.
    expect(sala.trocados).toEqual([])
    expect(JSON.parse(localStorage.getItem('altcast:dispositivos') ?? '{}'))
      .toMatchObject({ audiooutput: 'fone' })
  })

  it('dispositivo que o navegador recusa vira mensagem, nao silencio', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.falharTroca = true
    await chamada.trocarDispositivo('videoinput', 'camera-quebrada')

    expect(chamada.estado().erro).toContain('Nao foi possivel usar esse dispositivo')
  })
})

describe('saida', () => {
  it('avisa a API antes de desconectar do SFU e zera o estado', async () => {
    const { chamada, sala, enviados } = montar()
    await chamada.entrar()
    await chamada.definirMicrofone(true)
    await chamada.sair()

    expect(tipos(enviados)).toEqual(['voice.join', 'voice.state', 'voice.leave'])
    expect(sala.desconectou).toBe(true)
    expect(chamada.estado()).toMatchObject({ fase: 'fora', microfone: false, faixas: [] })
  })

  it('sair sem ter entrado nao estoura', async () => {
    const { chamada } = montar()
    await expect(chamada.sair()).resolves.toBeUndefined()
  })
})

describe('socket caido', () => {
  it('o anuncio perdido nao vira fila: o estado local segue verdadeiro', async () => {
    const sala = new SalaFalsa()
    const chamada = criarChamada({
      channelId: 'c1',
      // Socket fechado: `enviar` devolve false, como socket.ts faz.
      enviar: () => false,
      aoMudar: vi.fn(),
      criarSala: () => sala,
      obterCredencial: async () => CREDENCIAL,
    })
    await chamada.entrar()
    await chamada.definirMicrofone(true)

    // A midia subiu mesmo sem a API ter sido avisada — e o que faz a chamada
    // sobreviver a uma reconexao do WebSocket.
    expect(sala.chamadas).toContain('mic:true')
    expect(chamada.estado().microfone).toBe(true)
  })
})

/**
 * O defeito que motivou esta suite: dezoito compartilhamentos de tela subiram
 * ao SFU de producao e nenhum trouxe faixa `SCREEN_SHARE_AUDIO` junto. O
 * LiveKit nao captura o som da tela por conta propria — sem pedir, o navegador
 * nem oferece a caixa "compartilhar audio da guia", e a transmissao sai muda
 * sem que nada, em lugar nenhum, registre um erro.
 */
describe('som da tela compartilhada', () => {
  it('compartilhar a tela pede o audio dela junto', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirTela(true)

    expect(sala.chamadas).toContain('tela:true')
    expect(sala.opcoesDaTela).toEqual({ audio: true })
  })

  it('o som da tela alheia vira faixa propria, distinta do microfone', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(
      RoomEvent.TrackSubscribed,
      { sid: 'TR_TELA_AUDIO' },
      { kind: 'audio', source: 'screen_share_audio' },
      { identity: 'u2' },
    )

    // Separar os dois papeis e o que impede o som da tela de sequestrar o
    // medidor do microfone e de ser tratado como eco.
    expect(chamada.estado().faixas).toMatchObject([
      { userId: 'u2', papel: 'audio-tela', local: false },
    ])
  })

  it('o som da propria tela nao volta pelo proprio alto-falante', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.LocalTrackPublished, {
      kind: 'audio', source: 'screen_share_audio', track: { sid: 'TR_MINHA_TELA' },
    })

    // Reproduzir aqui criaria realimentacao com o proprio alto-falante — o
    // mesmo motivo pelo qual o microfone proprio tambem nao vira faixa.
    expect(chamada.estado().faixas).toEqual([])
  })
})

/**
 * O segundo silencio possivel, e o mais traicoeiro: o navegador recusa tocar o
 * audio remoto por politica de autoplay. Tudo indica sucesso — a faixa chegou,
 * o elemento existe, o SFU esta entregando — e ninguem ouve nada.
 */
describe('audio barrado pelo navegador', () => {
  it('o bloqueio vira estado visivel em vez de silencio inexplicado', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    expect(chamada.estado().audioBloqueado).toBe(false)

    sala.canPlaybackAudio = false
    sala.emitir(RoomEvent.AudioPlaybackStatusChanged)

    expect(chamada.estado().audioBloqueado).toBe(true)
  })

  it('o gesto da pessoa destrava o audio e some com o aviso', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.canPlaybackAudio = false
    sala.emitir(RoomEvent.AudioPlaybackStatusChanged)

    await chamada.destravarAudio()

    expect(sala.destravou).toBe(1)
    expect(chamada.estado().audioBloqueado).toBe(false)
  })

  it('destravar fora da chamada nao estoura', async () => {
    const { chamada } = montar()
    await expect(chamada.destravarAudio()).resolves.toBeUndefined()
  })
})

describe('saida de som escolhida', () => {
  it('vale desde a entrada, e nao so depois de trocar na mao', async () => {
    localStorage.clear()
    localStorage.setItem('altcast:dispositivos', JSON.stringify({ audiooutput: 'fone-usb' }))
    const { chamada, sala } = montar()
    await chamada.entrar()

    // Aplicar so na troca manual faz a primeira frase da chamada sair pelo
    // alto-falante errado — as vezes por um que nem esta ligado.
    expect(sala.trocados).toContain('audiooutput:fone-usb')
    localStorage.clear()
  })
})
