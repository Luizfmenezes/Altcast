import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimd from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import gtcrnWorklet from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url'
import gtcrnWasm from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url'

/**
 * A supressao de ruido por rede neural — o "Krisp" do Altcast.
 *
 * A supressao do navegador (`noiseSuppression` no `getUserMedia`) e um filtro
 * espectral classico: tira chiado constante — ventilador, ar-condicionado — e
 * deixa passar tudo o que muda, que e justamente o que incomoda numa chamada:
 * teclado, cachorro, a louca batendo na cozinha. Uma rede treinada em voz
 * separa VOZ de NAO-VOZ, e por isso pega o ruido que muda.
 *
 * Dois modelos, os dois rodando NA MAQUINA de quem fala, dentro de um
 * AudioWorklet em WebAssembly. Nenhum som sai do computador para ser limpo, e
 * nao ha servico pago no caminho — o Krisp do LiveKit exige o LiveKit Cloud, e
 * o nosso SFU e proprio.
 *
 * - `gtcrn`: rede mais nova (2024), o padrao. Num teste com ruido branco
 *   derruba o ruido em ~60 dB — o nivel do Krisp.
 * - `rnnoise`: leve (~150 KB, 10 ms de quadro), a opcao para maquina fraca.
 *   Mais branda (~7 dB no mesmo teste), mas nao aparece no uso de CPU.
 *
 * Este arquivo e carregado sob demanda por `midia.ts`, e so quando a pessoa
 * esta numa chamada com a supressao por IA ligada: quem nunca fala nao baixa
 * modelo nenhum.
 */

export type ModeloDeIa = 'rnnoise' | 'gtcrn'

/** O binario de cada modelo, baixado uma vez por aba. */
const binarios: Partial<Record<ModeloDeIa, Promise<ArrayBuffer>>> = {}

/**
 * Os worklets registrados em cada contexto.
 *
 * `addModule` duas vezes no mesmo contexto registra o processador de novo e o
 * navegador reclama que o nome ja existe; por isso a memoria e POR contexto.
 */
const registrados = new WeakMap<BaseAudioContext, Map<ModeloDeIa, Promise<void>>>()

async function binario(modelo: ModeloDeIa): Promise<ArrayBuffer> {
  const lib = await import('@sapphi-red/web-noise-suppressor')
  binarios[modelo] ??= modelo === 'rnnoise'
    ? lib.loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseWasmSimd })
    : lib.loadGtcrn({ url: gtcrnWasm })
  try {
    return await binarios[modelo]
  } catch (erro) {
    // Uma falha de rede nao pode ficar memorizada para sempre: a proxima
    // chamada tenta baixar de novo.
    delete binarios[modelo]
    throw erro
  }
}

function registrar(contexto: BaseAudioContext, modelo: ModeloDeIa): Promise<void> {
  let doContexto = registrados.get(contexto)
  if (doContexto === undefined) {
    doContexto = new Map()
    registrados.set(contexto, doContexto)
  }
  let pendente = doContexto.get(modelo)
  if (pendente === undefined) {
    pendente = contexto.audioWorklet.addModule(modelo === 'rnnoise' ? rnnoiseWorklet : gtcrnWorklet)
    doContexto.set(modelo, pendente)
  }
  return pendente
}

type Grafo = { saida: MediaStreamTrack; desmontar: () => void }

async function montar(opcoes: AudioProcessorOptions, modelo: ModeloDeIa): Promise<Grafo> {
  const contexto = opcoes.audioContext
  // O contexto nasce suspenso fora de um gesto. Entrar na chamada vem de um
  // clique, entao aqui o `resume` costuma valer; se nao valer, o som passa a
  // fluir no primeiro gesto seguinte, que o `destravarSons` ja provoca.
  if (contexto.state === 'suspended') await contexto.resume().catch(() => undefined)

  const [wasmBinary, lib] = await Promise.all([
    binario(modelo),
    import('@sapphi-red/web-noise-suppressor'),
    registrar(contexto, modelo),
  ])

  const fonte = contexto.createMediaStreamSource(new MediaStream([opcoes.track]))

  // Corta abaixo de 80 Hz antes da rede: e onde mora o ronco da mesa, o
  // pe batendo e o vento no microfone. Nenhuma voz humana vive ali, e o
  // modelo trabalha melhor sem ter de gastar capacidade com isso.
  const graves = contexto.createBiquadFilter()
  graves.type = 'highpass'
  graves.frequency.value = 80

  const rede = modelo === 'rnnoise'
    ? new lib.RnnoiseWorkletNode(contexto, { wasmBinary, maxChannels: 1 })
    : new lib.GtcrnWorkletNode(contexto, { wasmBinary, maxChannels: 1 })

  const destino = contexto.createMediaStreamDestination()
  fonte.connect(graves).connect(rede).connect(destino)

  const saida = destino.stream.getAudioTracks()[0]
  if (saida === undefined) throw new Error('o destino de audio nao produziu faixa')

  return {
    saida,
    desmontar: () => {
      fonte.disconnect()
      graves.disconnect()
      rede.disconnect()
      rede.destroy()
      saida.stop()
    },
  }
}

/**
 * O processador que o LiveKit pluga no microfone.
 *
 * A forma segue `TrackProcessor` do SDK: `init` monta o grafo e expoe a faixa
 * limpa em `processedTrack`, que e o que o SDK passa a publicar; `restart` e
 * chamado quando o microfone e trocado no meio da chamada; `destroy`, quando
 * a supressao e desligada ou a chamada acaba.
 */
export function criarSupressorDeRuido(
  modelo: ModeloDeIa,
): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  return new SupressorDeRuido(modelo)
}

class SupressorDeRuido implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name: string
  processedTrack?: MediaStreamTrack
  private grafo: Grafo | null = null

  constructor(private readonly modelo: ModeloDeIa) {
    this.name = `altcast-supressao-${modelo}`
  }

  async init(opcoes: AudioProcessorOptions): Promise<void> {
    this.grafo = await montar(opcoes, this.modelo)
    this.processedTrack = this.grafo.saida
  }

  async restart(opcoes: AudioProcessorOptions): Promise<void> {
    this.desmontar()
    await this.init(opcoes)
  }

  destroy(): Promise<void> {
    this.desmontar()
    return Promise.resolve()
  }

  private desmontar(): void {
    this.grafo?.desmontar()
    this.grafo = null
    delete this.processedTrack
  }
}
