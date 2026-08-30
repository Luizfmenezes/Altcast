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
  /** O terceiro: o que sobe para o SFU, separado do que o navegador grava. */
  publicacaoDaTela: unknown = undefined
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
    setScreenShareEnabled: (
      v: boolean, opcoes?: unknown, publicacao?: unknown,
    ): Promise<unknown> => {
      this.opcoesDaTela = opcoes
      this.publicacaoDaTela = publicacao
      return this.dispositivo('tela', v)
    },
  }

  /** O navegador pode recusar o gesto — um clique sintetico, por exemplo. */
  recusarDestravar = false

  async startAudio(): Promise<void> {
    this.destravou += 1
    if (this.recusarDestravar) throw new Error('gesto recusado')
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

function montar(opcoes: {
  credencial?: Credencial
  erroDaCredencial?: unknown
  /**
   * As saidas de som que a maquina tem AGORA. O padrao e a lista vazia, que e
   * o que um navegador sem permissao concedida devolve — e tambem o que o
   * jsdom devolve, entao o padrao aqui e o comportamento real do ambiente.
   */
  saidas?: { deviceId: string; label: string }[]
} = {}): {
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
    listarSaidas: async () => opcoes.saidas ?? [],
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
    expect(sala.opcoesDaTela).toMatchObject({ audio: true })
  })

  it('a captura e pedida a 60 quadros, e nao so a codificacao', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirTela(true)

    // Esta e a metade que some sem deixar rastro. Codificar a 60 quadros com
    // uma captura de 30 nao da erro em lugar nenhum: o navegador entrega 30, o
    // SFU aceita 30, e a transmissao continua a 30 com todo o resto
    // configurado para 60.
    expect(sala.opcoesDaTela).toMatchObject({
      resolution: { width: 1920, height: 1080, frameRate: 60 },
    })
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
    // A entrada ja tenta destravar uma vez; o que este teste prova e que o
    // clique no botao chega ao SDK, e nao quantas tentativas houve ao todo.
    const antes = sala.destravou

    await chamada.destravarAudio()

    expect(sala.destravou).toBe(antes + 1)
    expect(chamada.estado().audioBloqueado).toBe(false)
  })

  it('destravar fora da chamada nao estoura', async () => {
    const { chamada } = montar()
    await expect(chamada.destravarAudio()).resolves.toBeUndefined()
  })

  it('a entrada tenta destravar dentro do gesto que a abriu', async () => {
    const { chamada, sala } = montar()
    sala.canPlaybackAudio = false
    await chamada.entrar()

    // `entrar()` nasce de um clique, e a ativacao da pessoa ainda vale ali. E
    // o unico instante da chamada em que da para destravar sem cobrar um
    // segundo clique de quem ja clicou uma vez.
    expect(sala.destravou).toBe(1)
    expect(chamada.estado().audioBloqueado).toBe(false)
  })

  it('sala que ja conecta bloqueada mostra o botao sem depender de evento', async () => {
    const { chamada, sala } = montar()
    sala.canPlaybackAudio = false
    sala.recusarDestravar = true
    await chamada.entrar()

    // Nenhum `AudioPlaybackStatusChanged` e emitido aqui, de proposito: uma
    // sala que ja nasce bloqueada nunca MUDA de estado, e o evento so avisa de
    // mudancas. Sem ler `canPlaybackAudio` na entrada, o botao jamais seria
    // renderizado e o audio morreria calado — sem erro e sem aviso.
    expect(chamada.estado().audioBloqueado).toBe(true)
    expect(chamada.estado().fase).toBe('dentro')
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

  it('saida que sumiu da maquina e ignorada em vez de engolir o som', async () => {
    localStorage.clear()
    localStorage.setItem(
      'altcast:dispositivos', JSON.stringify({ audiooutput: 'fone-que-sumiu' }),
    )
    const { chamada, sala } = montar({
      saidas: [{ deviceId: 'alto-falante', label: 'Alto-falante' }],
    })
    await chamada.entrar()

    // O `catch` da troca so cobre a troca que FALHA. Este e o outro caso, e o
    // mais traicoeiro dos dois: a troca que FUNCIONA apontando para o lugar
    // errado. Um fone desligado que o sistema ainda enumera aceita o ajuste
    // sem reclamar, e o som passa a sair por um dispositivo que ninguem esta
    // escutando — com todos os indicadores da tela dizendo que esta tudo bem.
    expect(sala.trocados).toEqual([])
    localStorage.clear()
  })

  it('lista vazia nao e prova de que o dispositivo sumiu', async () => {
    localStorage.clear()
    localStorage.setItem('altcast:dispositivos', JSON.stringify({ audiooutput: 'fone-usb' }))
    const { chamada, sala } = montar({ saidas: [] })
    await chamada.entrar()

    // Vazio e o que o navegador devolve ANTES de conceder a permissao.
    // Descartar a preferencia aqui trocaria um defeito raro por um constante.
    expect(sala.trocados).toContain('audiooutput:fone-usb')
    localStorage.clear()
  })
})

/**
 * O volume de cada fonte de som, separado por fonte.
 *
 * A queixa que estes testes protegem e concreta: numa sala em que alguem
 * compartilha um jogo alto e comenta baixo, um controle so — o do sistema
 * operacional — obriga a escolher entre ouvir o jogo e ouvir a pessoa.
 */
describe('volume por transmissao', () => {
  /** Uma faixa remota que sabe ter o volume ajustado, como a do LiveKit sabe. */
  const faixaSonora = (): { sid: string; volume: number; setVolume: (v: number) => void } => {
    const f = {
      sid: 'TR_SOM',
      volume: 1,
      setVolume: (v: number) => { f.volume = v },
    }
    return f
  }

  const MICROFONE = { kind: 'audio', source: 'microphone' }
  const SOM_DA_TELA = { kind: 'audio', source: 'screen_share_audio' }

  it('ajustar o volume mexe na faixa e nao so no estado', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    const som = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, som, MICROFONE, { identity: 'u2' })

    chamada.definirVolume('u2', 'audio', 0.25)

    // O estado sozinho moveria o cursor sem mudar o som — exatamente o defeito
    // que um controle de volume nao pode ter.
    expect(som.volume).toBe(0.25)
    expect(chamada.estado().volumes['u2:audio']).toBe(0.25)
    localStorage.clear()
  })

  it('o ajuste guardado vale desde o primeiro pacote da faixa', async () => {
    localStorage.clear()
    localStorage.setItem('altcast:volumes', JSON.stringify({ 'u2:audio-tela': 0.1 }))
    const { chamada, sala } = montar()
    await chamada.entrar()
    const som = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, som, SOM_DA_TELA, { identity: 'u2' })

    // Aplicar depois deixaria escapar um segundo no volume anterior — o susto
    // que a pessoa abaixou o volume justamente para evitar.
    expect(som.volume).toBe(0.1)
    localStorage.clear()
  })

  it('o microfone e a tela da mesma pessoa tem volumes independentes', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    const voz = faixaSonora()
    const tela = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, voz, MICROFONE, { identity: 'u2' })
    sala.emitir(RoomEvent.TrackSubscribed, tela, SOM_DA_TELA, { identity: 'u2' })

    chamada.definirVolume('u2', 'audio-tela', 0)

    // Silenciar o jogo que alguem transmite nao pode silenciar a pessoa que o
    // esta comentando.
    expect(tela.volume).toBe(0)
    expect(voz.volume).toBe(1)
    localStorage.clear()
  })

  it('o ajuste sobrevive a saida da chamada', async () => {
    localStorage.clear()
    const { chamada } = montar()
    await chamada.entrar()
    chamada.definirVolume('u2', 'audio', 0.4)
    await chamada.sair()

    // E preferencia da pessoa, nao estado da sala: zerar aqui devolveria o som
    // no talo a cada reconexao.
    expect(chamada.estado().volumes['u2:audio']).toBe(0.4)
    localStorage.clear()
  })

  it('valores fora da faixa sao contidos em vez de chegarem ao codificador', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    const som = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, som, MICROFONE, { identity: 'u2' })

    chamada.definirVolume('u2', 'audio', 9)
    expect(som.volume).toBe(1)
    chamada.definirVolume('u2', 'audio', -3)
    expect(som.volume).toBe(0)
    localStorage.clear()
  })

  it('ensurdecer NAO destroi os ajustes individuais', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    const voz = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, voz, MICROFONE, { identity: 'u2' })
    chamada.definirVolume('u2', 'audio', 0.3)

    await chamada.definirSurdo(true)
    expect(voz.volume).toBe(0)

    await chamada.definirSurdo(false)

    // Este e o ponto todo do interruptor ser POR CIMA: se ensurdecer fosse um
    // `definirVolume(0)` em cada faixa, desfazer devolveria a sala ao volume
    // cheio e apagaria ajustes que a pessoa levou meses acertando.
    expect(voz.volume).toBe(0.3)
    expect(chamada.estado().volumes['u2:audio']).toBe(0.3)
    localStorage.clear()
  })

  it('ensurdecer cala o proprio microfone junto', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirMicrofone(true)

    await chamada.definirSurdo(true)

    // E o que a palavra significa em toda ferramenta que a usa: "sai um
    // pouco". Ficar mudo para a sala e continuar falando seria o pior dos
    // dois mundos.
    expect(sala.chamadas).toContain('mic:false')
    expect(chamada.estado().microfone).toBe(false)
    localStorage.clear()
  })

  it('quem chega durante o surdo tambem chega calado', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirSurdo(true)

    const atrasado = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, atrasado, MICROFONE, { identity: 'u3' })

    // Sem isto, ficar surdo silenciaria so quem ja estava na sala, e cada
    // pessoa que entrasse depois voltaria a ser ouvida.
    expect(atrasado.volume).toBe(0)
    localStorage.clear()
  })

  it('restaurar devolve o som cheio agora, e nao so na proxima chamada', async () => {
    localStorage.clear()
    localStorage.setItem('altcast:volumes', JSON.stringify({ 'u2:audio': 0 }))
    const { chamada, sala } = montar()
    await chamada.entrar()
    const som = faixaSonora()
    sala.emitir(RoomEvent.TrackSubscribed, som, MICROFONE, { identity: 'u2' })
    expect(som.volume).toBe(0)

    chamada.restaurarVolumes()

    // Um `0` guardado numa chamada antiga silencia alguem para sempre e viaja
    // com o NAVEGADOR, nao com o codigo — sobrevive a qualquer correcao do
    // sistema. E limpar so a chave consertaria a PROXIMA chamada, deixando
    // muda justamente aquela em que a pessoa esta enquanto procura o botao.
    expect(som.volume).toBe(1)
    expect(chamada.estado().volumes).toEqual({})
    expect(localStorage.getItem('altcast:volumes')).toBeNull()
    localStorage.clear()
  })
})

/**
 * A qualidade da propria tela, escolhida por quem transmite.
 *
 * O que estes testes protegem e a coerencia entre as duas metades. Elas ficam
 * em lugares diferentes do SDK — captura no segundo argumento, codificacao no
 * terceiro — e uma divergencia entre as duas nao produz erro nenhum: produz
 * uma transmissao na qualidade errada, sem rastro.
 */
/**
 * A qualidade que quem ASSISTE escolhe.
 *
 * A assimetria que isto conserta: ate agora so quem publicava tinha escolha, e
 * a unica saida para "travou pra mim" era pedir a quem transmite que piorasse
 * a transmissao para a sala inteira.
 */
describe('qualidade escolhida por quem assiste', () => {
  /** Uma publicacao remota que sabe trocar de camada, como a do LiveKit sabe. */
  const publicacaoDeVideo = (): {
    kind: string; source: string; camada: number | null; setVideoQuality: (q: number) => void
  } => {
    const p = {
      kind: 'video',
      source: 'screen_share',
      camada: null as number | null,
      setVideoQuality: (q: number) => { p.camada = q },
    }
    return p
  }

  it('escolher um nivel chega a publicacao daquela faixa, e so dela', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    const daAna = publicacaoDeVideo()
    const doBruno = publicacaoDeVideo()
    sala.emitir(RoomEvent.TrackSubscribed, { sid: 'TR_ANA' }, daAna, { identity: 'ana' })
    sala.emitir(RoomEvent.TrackSubscribed, { sid: 'TR_BRUNO' }, doBruno, { identity: 'bruno' })

    chamada.definirQualidadeDeRecepcao('TR_ANA', 'baixa')

    // Baixar a tela de uma pessoa nao pode mexer na de outra — e, sobretudo,
    // nao mexe no que qualquer uma delas PUBLICA.
    expect(daAna.camada).toBe(0)
    expect(doBruno.camada).toBeNull()
    expect(chamada.estado().recepcao['TR_ANA']).toBe('baixa')
  })

  it('automatica e o que vale para quem nunca escolheu', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(
      RoomEvent.TrackSubscribed, { sid: 'TR_ANA' }, publicacaoDeVideo(), { identity: 'ana' },
    )

    expect(chamada.estado().recepcao).toEqual({})
  })

  it('a escolha morre com a faixa em vez de virar lixo indexado por sid', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    const faixa = { sid: 'TR_ANA' }
    sala.emitir(RoomEvent.TrackSubscribed, faixa, publicacaoDeVideo(), { identity: 'ana' })
    chamada.definirQualidadeDeRecepcao('TR_ANA', 'media')

    sala.emitir(RoomEvent.TrackUnsubscribed, faixa)

    // O proximo `sid` que o SFU emitir nunca sera este: guardar a preferencia
    // so acumularia entradas mortas.
    expect(chamada.estado().recepcao).toEqual({})
  })

  it('sair da chamada esquece a escolha: a rede de ontem nao e a de hoje', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(
      RoomEvent.TrackSubscribed, { sid: 'TR_ANA' }, publicacaoDeVideo(), { identity: 'ana' },
    )
    chamada.definirQualidadeDeRecepcao('TR_ANA', 'baixa')
    await chamada.sair()

    // Ao contrario do volume, que e preferencia sobre uma PESSOA e sobrevive,
    // a qualidade e preferencia sobre uma REDE e nao deve atravessar chamadas.
    expect(chamada.estado().recepcao).toEqual({})
    localStorage.clear()
  })

  it('escolher para uma faixa que nao existe nao estoura', async () => {
    const { chamada } = montar()
    await chamada.entrar()
    expect(() => { chamada.definirQualidadeDeRecepcao('TR_FANTASMA', 'alta') }).not.toThrow()
  })
})

describe('forca do sinal', () => {
  it('o aviso do SFU vira estado por pessoa', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()

    sala.emitir(RoomEvent.ConnectionQualityChanged, 'poor', { identity: 'ana' })

    // "O video de fulano esta ruim" nao distingue a camera dele da rede dele, e
    // as duas pedem providencias opostas. O SFU ja sabia a resposta.
    expect(chamada.estado().sinais['ana']).toBe('ruim')
  })

  it('um nivel que o SDK invente amanha e ignorado em vez de virar rotulo vazio', async () => {
    const { chamada, sala } = montar()
    await chamada.entrar()
    sala.emitir(RoomEvent.ConnectionQualityChanged, 'quantica', { identity: 'ana' })

    expect(chamada.estado().sinais).toEqual({})
  })
})

describe('qualidade da tela escolhida pela pessoa', () => {
  it('1080p60 e o padrao de quem nunca escolheu', async () => {
    localStorage.clear()
    const { chamada } = montar()
    await chamada.entrar()

    expect(chamada.estado().qualidade).toBe('1080p60')
  })

  it('a escolha chega inteira as duas metades, e nao so a uma', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    chamada.definirQualidade('720p30')
    await chamada.definirTela(true)

    // Capturar a 720p e codificar a 1080p desperdicaria banda descrevendo
    // pixels inventados; o inverso jogaria fora metade do que foi gravado.
    expect(sala.opcoesDaTela).toMatchObject({
      resolution: { width: 1280, height: 720, frameRate: 30 },
    })
    expect(sala.publicacaoDaTela).toMatchObject({
      screenShareEncoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
    })
    localStorage.clear()
  })

  it('a escolha vale na proxima partilha, sem sair da chamada', async () => {
    localStorage.clear()
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirTela(true)
    expect(sala.publicacaoDaTela).toMatchObject({
      screenShareEncoding: { maxFramerate: 60 },
    })

    chamada.definirQualidade('1080p30')
    await chamada.definirTela(false)
    await chamada.definirTela(true)

    // Sem o terceiro argumento de `setScreenShareEnabled` a codificacao ficaria
    // congelada no `publishDefaults` da construcao da sala, e a troca so
    // valeria depois de sair e entrar de novo na chamada.
    expect(sala.publicacaoDaTela).toMatchObject({
      screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
    })
    localStorage.clear()
  })

  it('a escolha sobrevive a saida e a proxima chamada', async () => {
    localStorage.clear()
    const primeira = montar()
    await primeira.chamada.entrar()
    primeira.chamada.definirQualidade('720p30')
    await primeira.chamada.sair()

    // A escolha e da maquina e da rede dela — um notebook em 4G nao quer
    // reconfigurar a qualidade toda vez que entra numa sala.
    expect(primeira.chamada.estado().qualidade).toBe('720p30')
    expect(montar().chamada.estado().qualidade).toBe('720p30')
    localStorage.clear()
  })

  it('um valor invalido guardado cai no padrao em vez de quebrar a chamada', async () => {
    localStorage.clear()
    localStorage.setItem('altcast:qualidade-da-tela', '4k144')
    const { chamada, sala } = montar()
    await chamada.entrar()
    await chamada.definirTela(true)

    // Uma versao futura pode renomear as opcoes. Herdar um nome que nao existe
    // mais nao pode impedir alguem de compartilhar a tela.
    expect(chamada.estado().qualidade).toBe('1080p60')
    expect(sala.chamadas).toContain('tela:true')
    localStorage.clear()
  })
})
