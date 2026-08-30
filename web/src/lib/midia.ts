import type {
  LocalTrackPublication, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Track,
} from 'livekit-client'
import { api } from './api.js'

/**
 * O SDK do LiveKit sozinho passa de meio megabyte. Ele e carregado no primeiro
 * clique em "entrar na chamada", e nao no arranque: quem so escreve mensagem
 * nunca paga por um cliente de SFU que jamais vai usar.
 *
 * O `import()` fica memorizado, entao entrar na segunda chamada nao baixa nada.
 */
type ModuloLiveKit = typeof import('livekit-client')

let modulo: Promise<ModuloLiveKit> | null = null

function carregarLiveKit(): Promise<ModuloLiveKit> {
  modulo ??= import('livekit-client')
  return modulo
}

/**
 * A camada de midia do cliente.
 *
 * Este e o unico arquivo do frontend que conhece o LiveKit — spec 01: "trocar
 * LiveKit por mediasoup afeta um modulo e nada mais". A interface acima dele
 * fala de microfone, camera e tela; nunca de faixas, publicacoes ou salas.
 *
 * A divisao de trabalho com o WebSocket da API e deliberada e vale entender: o
 * SFU transporta os bytes de audio e video, e o WebSocket transporta a VERDADE
 * sobre quem esta transmitindo o que. Sao dois canais porque so um deles — o da
 * API — sabe quem tem permissao de estar ali. Por isso `voice.state` sai pelo
 * socket, e nao por `canPublishData`, que o token desliga de proposito.
 */

/** O que o token permite. Vem do servidor, nunca de uma decisao do cliente. */
export type Credencial = {
  url: string
  token: string
  room: string
  identity: string
  expiresIn: number
  podePublicar: boolean
  moderador: boolean
  participants: { userId: string; microfone: boolean; camera: boolean; tela: boolean }[]
}

export type TipoDeDispositivo = 'audioinput' | 'videoinput' | 'audiooutput'

export type Dispositivo = { deviceId: string; label: string }

export type Preferencias = Partial<Record<TipoDeDispositivo, string>>

const CHAVE_DE_PREFERENCIAS = 'altcast:dispositivos'

/**
 * Qual microfone, camera e saida de som usar.
 *
 * Fica no navegador, e nao no servidor, porque a escolha e da MAQUINA e nao da
 * pessoa: o mesmo usuario no desktop e no notebook quer dispositivos
 * diferentes, e sincronizar isso pela conta trocaria o microfone certo pelo de
 * outro computador.
 */
export function lerPreferencias(): Preferencias {
  try {
    const bruto = localStorage.getItem(CHAVE_DE_PREFERENCIAS)
    return bruto === null ? {} : JSON.parse(bruto) as Preferencias
  } catch {
    // Aba anonima, armazenamento bloqueado, JSON corrompido: o padrao do
    // sistema e uma resposta melhor do que uma tela que nao abre.
    return {}
  }
}

export function guardarPreferencia(tipo: TipoDeDispositivo, deviceId: string): void {
  try {
    localStorage.setItem(
      CHAVE_DE_PREFERENCIAS,
      JSON.stringify({ ...lerPreferencias(), [tipo]: deviceId }),
    )
  } catch {
    // Nao poder lembrar a escolha nao pode impedir de faze-la agora.
  }
}

/**
 * Os dispositivos que o navegador expoe. Os NOMES so aparecem depois que a
 * pessoa concede a permissao — antes disso o navegador devolve rotulos vazios,
 * de proposito, para que um site nao consiga identificar a maquina sem pedir.
 */
export async function listarDispositivos(tipo: TipoDeDispositivo): Promise<Dispositivo[]> {
  try {
    const lk = await carregarLiveKit()
    const lista = await lk.Room.getLocalDevices(tipo)
    return lista
      .filter(d => d.deviceId !== '')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label === '' ? `Dispositivo ${String(i + 1)}` : d.label,
      }))
  } catch {
    return []
  }
}

/**
 * `audio` e o microfone de alguem; `audio-tela` e o som do que essa pessoa
 * esta compartilhando. Sao papeis separados porque as regras deles divergem
 * exatamente onde importa: o microfone proprio alimenta o medidor de nivel, e
 * o som da propria tela nao alimenta nada — nem medidor, nem alto-falante.
 */
export type PapelDaFaixa = 'camera' | 'tela' | 'audio' | 'audio-tela'

export type Faixa = {
  /** A identidade no LiveKit e o proprio userId da API — media/token.ts. */
  userId: string
  papel: PapelDaFaixa
  track: Track
  /**
   * A propria pessoa. Precisa ser distinguida por dois motivos praticos: o
   * video proprio se ve espelhado, como num espelho de verdade, e o audio
   * proprio NUNCA e reproduzido — tocar o proprio microfone de volta e eco.
   */
  local: boolean
}

export type Fase = 'fora' | 'entrando' | 'dentro' | 'erro'

export type EstadoDaChamada = {
  fase: Fase
  faixas: Faixa[]
  /** Quem esta falando agora, para a interface destacar sem ler o audio. */
  falando: string[]
  microfone: boolean
  camera: boolean
  tela: boolean
  podePublicar: boolean
  /**
   * O quanto o microfone esta captando agora, de 0 a 1. E a unica resposta
   * honesta para "sera que estao me ouvindo?": o botao diz que o microfone
   * esta ligado, e so o nivel diz que ele esta captando alguma coisa.
   */
  nivel: number
  /**
   * O navegador recusou tocar o audio remoto por politica de autoplay.
   *
   * E o silencio mais dificil de diagnosticar que existe numa chamada: a faixa
   * chegou, o elemento esta no DOM, o SFU esta entregando os pacotes, e
   * ninguem ouve nada. Vira estado para que a interface possa oferecer o clique
   * que o navegador exige, em vez de deixar a pessoa procurando defeito no
   * fone de ouvido.
   */
  audioBloqueado: boolean
  erro: string | null
}

export const ESTADO_INICIAL: EstadoDaChamada = {
  fase: 'fora',
  faixas: [],
  falando: [],
  microfone: false,
  camera: false,
  tela: false,
  podePublicar: false,
  nivel: 0,
  audioBloqueado: false,
  erro: null,
}

/**
 * A superficie do LiveKit que de fato usamos. Existe para que o teste possa
 * injetar uma sala falsa sem subir um SFU — e, de quebra, documenta em dez
 * linhas o tamanho real do acoplamento com a biblioteca.
 */
export type SalaDeMidia = {
  connect: (url: string, token: string) => Promise<void>
  disconnect: () => Promise<void>
  on: (evento: string, ouvinte: (...args: never[]) => void) => unknown
  switchActiveDevice: (tipo: TipoDeDispositivo, deviceId: string) => Promise<unknown>
  /** Toca o audio represado. So funciona dentro de um gesto da pessoa. */
  startAudio: () => Promise<void>
  /** Falso enquanto o navegador estiver segurando a reproducao. */
  canPlaybackAudio?: boolean
  localParticipant: {
    setMicrophoneEnabled: (ligado: boolean) => Promise<unknown>
    setCameraEnabled: (ligado: boolean) => Promise<unknown>
    /**
     * O segundo argumento e o motivo desta assinatura existir por extenso: sem
     * `{ audio: true }` o LiveKit chama `getDisplayMedia` sem pedir som, o
     * Chrome nem mostra a caixa "compartilhar audio da guia", e a transmissao
     * sai muda sem erro em lugar nenhum.
     */
    setScreenShareEnabled: (
      ligado: boolean, opcoes?: { audio: boolean },
    ) => Promise<unknown>
  }
}

export type OpcoesDaChamada = {
  channelId: string
  /** Manda `voice.*` pelo WebSocket da API. Devolve false se o socket caiu. */
  enviar: (quadro: { t: string; d?: unknown }) => boolean
  aoMudar: (estado: EstadoDaChamada) => void
  /** Injetavel para teste; em producao e uma Room de verdade. */
  criarSala?: () => SalaDeMidia
  obterCredencial?: (channelId: string) => Promise<Credencial>
}

/**
 * `adaptiveStream` deixa o SFU parar de mandar o video que ninguem esta
 * mostrando, e `dynacast` para de subir camada que ninguem assiste. Sem os
 * dois, uma sala de oito pessoas gasta banda de oito mesmo com uma so em foco.
 */
function salaPadrao(lk: ModuloLiveKit): SalaDeMidia {
  const preferidos = lerPreferencias()
  return new lk.Room({
    adaptiveStream: true,
    dynacast: true,
    // A escolha guardada vale desde a PRIMEIRA captura. Aplicar depois, por
    // troca, faria o primeiro segundo de audio sair pelo microfone errado.
    ...(preferidos.audioinput === undefined
      ? {}
      : { audioCaptureDefaults: { deviceId: preferidos.audioinput } }),
    ...(preferidos.videoinput === undefined
      ? {}
      : { videoCaptureDefaults: { deviceId: preferidos.videoinput } }),
  }) as unknown as SalaDeMidia
}

const obterCredencialPadrao = (channelId: string): Promise<Credencial> =>
  api.post<Credencial>(`/channels/${channelId}/call-token`)

function papelDe(publicacao: RemoteTrackPublication, lk: ModuloLiveKit): PapelDaFaixa | null {
  if (publicacao.kind === 'audio') {
    return publicacao.source === lk.Track.Source.ScreenShareAudio ? 'audio-tela' : 'audio'
  }
  if (publicacao.source === lk.Track.Source.ScreenShare) return 'tela'
  if (publicacao.source === lk.Track.Source.Camera) return 'camera'
  // Fonte desconhecida — uma versao mais nova do SFU — nao vira quadrado vazio
  // na tela: e ignorada ate alguem ensinar a interface a mostra-la.
  return null
}

export type Chamada = {
  entrar: () => Promise<void>
  sair: () => Promise<void>
  trocarDispositivo: (tipo: TipoDeDispositivo, deviceId: string) => Promise<void>
  /** Chamar SEMPRE de dentro de um clique: o navegador exige o gesto. */
  destravarAudio: () => Promise<void>
  definirMicrofone: (ligado: boolean) => Promise<void>
  definirCamera: (ligado: boolean) => Promise<void>
  definirTela: (ligado: boolean) => Promise<void>
  estado: () => EstadoDaChamada
}

export function criarChamada(opcoes: OpcoesDaChamada): Chamada {
  const criarSala = opcoes.criarSala
  const obterCredencial = opcoes.obterCredencial ?? obterCredencialPadrao

  let estado: EstadoDaChamada = { ...ESTADO_INICIAL }
  let sala: SalaDeMidia | null = null
  /** Preenchido na entrada: e o `sub` do token, o mesmo userId da API. */
  let identidade = ''
  /** Desliga o medidor de nivel. Existe enquanto o microfone estiver ligado. */
  let pararDeMedir: (() => void) | null = null

  function aplicar(mudanca: Partial<EstadoDaChamada>): void {
    estado = { ...estado, ...mudanca }
    opcoes.aoMudar(estado)
  }

  /**
   * Anuncia o estado a API. A sala do SFU ja sabe o que chega nela; o
   * `voice.state` e para as OUTRAS pessoas do canal saberem sem precisar
   * assinar a faixa — e o que faz o ponto do microfone aparecer para quem ainda
   * nem entrou na chamada.
   */
  function anunciar(): void {
    opcoes.enviar({
      t: 'voice.state',
      d: {
        channelId: opcoes.channelId,
        microfone: estado.microfone,
        camera: estado.camera,
        tela: estado.tela,
      },
    })
  }

  /**
   * Liga o medidor de nivel na faixa de audio local.
   *
   * Amostrar dez vezes por segundo e o suficiente para a barra parecer viva
   * sem custar quadro: o olho nao distingue mais do que isso numa barra, e
   * medir a cada quadro gastaria bateria para nada.
   */
  function medirNivel(track: unknown, lk: ModuloLiveKit): void {
    pararDeMedir?.()
    try {
      const analisador = lk.createAudioAnalyser(
        track as Parameters<typeof lk.createAudioAnalyser>[0],
      )
      const relogio = setInterval(() => {
        aplicar({ nivel: Math.min(1, analisador.calculateVolume()) })
      }, 100)
      pararDeMedir = () => {
        clearInterval(relogio)
        void analisador.cleanup()
        pararDeMedir = null
        aplicar({ nivel: 0 })
      }
    } catch {
      // Sem medidor a chamada continua inteira; so a barra fica parada. Nunca
      // vale derrubar a transmissao por causa do indicador dela.
      pararDeMedir = null
    }
  }

  function ligarEventos(s: SalaDeMidia, lk: ModuloLiveKit): void {
    const { RoomEvent } = lk
    const ouvir = (evento: string, fn: (...args: never[]) => void): void => {
      s.on(evento, fn)
    }

    ouvir(RoomEvent.TrackSubscribed, ((
      track: RemoteTrack,
      publicacao: RemoteTrackPublication,
      participante: RemoteParticipant,
    ) => {
      const papel = papelDe(publicacao, lk)
      if (papel === null) return
      aplicar({
        faixas: [...estado.faixas, { userId: participante.identity, papel, track, local: false }],
      })
    }) as (...args: never[]) => void)

    // Sem estes dois, quem liga a propria camera olha para um retangulo vazio
    // e nao tem como saber se o dispositivo certo foi escolhido — a sala ve, e
    // so o dono nao ve.
    ouvir(RoomEvent.LocalTrackPublished, ((publicacao: LocalTrackPublication) => {
      const papel = papelDe(publicacao as unknown as RemoteTrackPublication, lk)
      if (papel === null) return
      // Audio proprio nao vira faixa — reproduzi-lo e eco —, mas vira medidor:
      // e assim que a pessoa ve que esta sendo captada.
      if (papel === 'audio') {
        if (publicacao.track) medirNivel(publicacao.track, lk)
        return
      }
      // O som da propria tela tambem nao volta pelo proprio alto-falante: seria
      // realimentacao. E, ao contrario do microfone, tambem nao alimenta o
      // medidor — a barra responde por "estao me ouvindo", nao pelo volume do
      // video que esta sendo transmitido.
      if (papel === 'audio-tela') return
      const track = publicacao.track
      if (!track) return
      aplicar({ faixas: [...estado.faixas, { userId: identidade, papel, track, local: true }] })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.LocalTrackUnpublished, ((publicacao: LocalTrackPublication) => {
      // So o MICROFONE desliga o medidor. Parar de compartilhar a tela tambem
      // despublica uma faixa de audio, e derrubar a barra por causa dela
      // apagaria o unico sinal de que o microfone continua captando.
      if (papelDe(publicacao as unknown as RemoteTrackPublication, lk) === 'audio') {
        pararDeMedir?.()
      }
      aplicar({ faixas: estado.faixas.filter(f => f.track !== publicacao.track) })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.TrackUnsubscribed, ((track: RemoteTrack) => {
      aplicar({ faixas: estado.faixas.filter(f => f.track !== track) })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.ParticipantDisconnected, ((participante: RemoteParticipant) => {
      // Sem isto, quem sai no meio de um congelamento de rede deixa o ultimo
      // quadro do video parado na tela como se ainda estivesse na sala.
      aplicar({ faixas: estado.faixas.filter(f => f.userId !== participante.identity) })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.AudioPlaybackStatusChanged, (() => {
      aplicar({ audioBloqueado: s.canPlaybackAudio === false })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.ActiveSpeakersChanged, ((falantes: { identity: string }[]) => {
      aplicar({ falando: falantes.map(p => p.identity) })
    }) as (...args: never[]) => void)

    ouvir(RoomEvent.Disconnected, (() => {
      // A queda pode vir do SFU, e nao de um clique. O estado local precisa
      // contar a verdade, e a API precisa saber que esta pessoa saiu.
      opcoes.enviar({ t: 'voice.leave', d: { channelId: opcoes.channelId } })
      sala = null
      aplicar({ ...ESTADO_INICIAL })
    }) as (...args: never[]) => void)
  }

  async function entrar(): Promise<void> {
    if (estado.fase === 'entrando' || estado.fase === 'dentro') return
    aplicar({ fase: 'entrando', erro: null })

    let credencial: Credencial
    try {
      credencial = await obterCredencial(opcoes.channelId)
    } catch (erro) {
      const codigo = (erro as { code?: string }).code
      // A unica falha que merece texto proprio: o operador nao configurou o
      // servidor de midia. Dizer "algo deu errado" mandaria a pessoa procurar
      // defeito no microfone dela.
      aplicar({
        fase: 'erro',
        erro: codigo === 'media_unavailable'
          ? 'A chamada esta fora do ar. O servidor de midia nao esta configurado.'
          : 'Nao foi possivel entrar na chamada.',
      })
      return
    }

    const lk = await carregarLiveKit()
    const s = criarSala === undefined ? salaPadrao(lk) : criarSala()
    ligarEventos(s, lk)
    try {
      await s.connect(credencial.url, credencial.token)
    } catch {
      aplicar({ fase: 'erro', erro: 'Nao foi possivel conectar ao servidor de midia.' })
      return
    }

    sala = s
    identidade = credencial.identity

    // A saida de som escolhida vale desde a ENTRADA. As outras duas ja valem:
    // microfone e camera entram por `audioCaptureDefaults`/`videoCaptureDefaults`
    // na construcao da sala. O alto-falante nao tem equivalente na construcao,
    // entao sem esta troca a primeira frase da chamada sai pelo dispositivo
    // errado — as vezes por um que nem esta ligado.
    const saida = lerPreferencias().audiooutput
    if (saida !== undefined) {
      try {
        await s.switchActiveDevice('audiooutput', saida)
      } catch {
        // O fone guardado pode ter sido desconectado desde a ultima chamada.
        // Cair no padrao do sistema e melhor do que recusar a entrada.
      }
    }

    aplicar({ fase: 'dentro', podePublicar: credencial.podePublicar })
    // A ordem importa: `voice.join` depois da conexao de midia de pe. Anunciar
    // antes faria a sala mostrar alguem que ainda pode falhar ao conectar.
    opcoes.enviar({ t: 'voice.join', d: { channelId: opcoes.channelId } })
  }

  /**
   * Um unico caminho para os tres botoes. O estado so muda DEPOIS que o
   * navegador entregou o dispositivo: marcar o microfone como ligado antes da
   * permissao mostraria a sala um microfone que nao existe.
   */
  async function definir(qual: 'microfone' | 'camera' | 'tela', ligado: boolean): Promise<void> {
    if (sala === null || !estado.podePublicar) return
    const local = sala.localParticipant
    const acao = qual === 'microfone'
      ? (v: boolean) => local.setMicrophoneEnabled(v)
      : qual === 'camera'
        ? (v: boolean) => local.setCameraEnabled(v)
        // `{ audio: true }` e o que faz o Chrome oferecer a caixa
        // "compartilhar audio da guia". Sem ele a tela sobe muda, e nada — nem
        // no navegador, nem no SFU — registra que faltou alguma coisa.
        : (v: boolean) => local.setScreenShareEnabled(v, { audio: true })

    try {
      await acao(ligado)
    } catch {
      // Permissao negada ou dispositivo ocupado. O estado nao muda, entao o
      // botao volta sozinho para desligado em vez de mentir que ligou.
      aplicar({ erro: 'O navegador nao liberou o dispositivo.' })
      return
    }
    aplicar({ [qual]: ligado, erro: null } as Partial<EstadoDaChamada>)
    anunciar()
  }

  async function sair(): Promise<void> {
    const s = sala
    sala = null
    pararDeMedir?.()
    // Avisar a API antes de desconectar: se o processo do SFU cair junto, a
    // sala da aplicacao ainda fica correta.
    opcoes.enviar({ t: 'voice.leave', d: { channelId: opcoes.channelId } })
    aplicar({ ...ESTADO_INICIAL })
    await s?.disconnect()
  }

  /**
   * Troca o dispositivo em uso, agora, sem sair da chamada — e guarda a
   * escolha para a proxima. Fora da chamada nao ha o que trocar: a preferencia
   * fica guardada e vale na proxima entrada.
   */
  async function trocarDispositivo(tipo: TipoDeDispositivo, deviceId: string): Promise<void> {
    guardarPreferencia(tipo, deviceId)
    if (sala === null) return
    try {
      await sala.switchActiveDevice(tipo, deviceId)
      aplicar({ erro: null })
    } catch {
      aplicar({ erro: 'Nao foi possivel usar esse dispositivo.' })
    }
  }

  /**
   * Destrava o audio que o navegador segurou.
   *
   * Precisa nascer de um clique — a politica de autoplay so aceita a
   * reproducao dentro de um gesto da pessoa. Por isso nao ha tentativa
   * automatica em lugar nenhum: ela falharia calada e o aviso sumiria da tela
   * sem que o som voltasse.
   */
  async function destravarAudio(): Promise<void> {
    if (sala === null) return
    try {
      await sala.startAudio()
      aplicar({ audioBloqueado: false })
    } catch {
      // O gesto nao contou (um clique sintetico, por exemplo). O aviso fica na
      // tela para a pessoa tentar de novo, que e a unica saida possivel.
    }
  }

  return {
    entrar,
    sair,
    trocarDispositivo,
    destravarAudio,
    definirMicrofone: ligado => definir('microfone', ligado),
    definirCamera: ligado => definir('camera', ligado),
    definirTela: ligado => definir('tela', ligado),
    estado: () => estado,
  }
}
