import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimd from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import gtcrnWorklet from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url'
import gtcrnWasm from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url'
import vozWorklet from './dsp/vozWorklet.ts?worker&url'
import type { AjusteDoPortao } from './dsp/voz.js'
import type { MedidaDoWorklet, MensagemParaOWorklet, OpcoesDoWorklet } from './dsp/vozWorklet.js'

/**
 * A cadeia de tratamento da voz — o "Krisp" do Altcast, e o que vem depois.
 *
 * A supressao do navegador (`noiseSuppression` no `getUserMedia`) e um filtro
 * espectral classico: tira chiado constante — ventilador, ar-condicionado — e
 * deixa passar tudo o que muda, que e justamente o que incomoda numa chamada:
 * teclado, cachorro, a louca batendo na cozinha. Uma rede treinada em voz
 * separa VOZ de NAO-VOZ, e por isso pega o ruido que muda.
 *
 * Tres modelos, todos rodando NA MAQUINA de quem fala, dentro de um
 * AudioWorklet em WebAssembly. Nenhum som sai do computador para ser limpo, e
 * nao ha servico pago no caminho — o Krisp do LiveKit exige o LiveKit Cloud, e
 * o nosso SFU e proprio.
 *
 * - `gtcrn`: rede de 2024, o padrao. Num teste com ruido branco derruba o
 *   ruido em ~60 dB. Trabalha a 16 kHz por dentro: limpa muito, mas a voz sai
 *   com o agudo de telefone.
 * - `dfn3`: DeepFilterNet3, a "alta qualidade". Trabalha em banda cheia, 48
 *   kHz, e a voz sai natural. Custa ~24 MB baixados uma vez e mais processador.
 * - `rnnoise`: leve (~150 KB), a opcao para maquina fraca. Mais branda.
 *
 * Depois da rede, o grafo e sempre o mesmo:
 *
 *   mic -> passa-altas 80 Hz -> rede -> [altcast-voz] -> compressor -> ganho -> limitador
 *                     \_________________________^ (original, para a intensidade)
 *
 * `altcast-voz` (ver `dsp/voz.ts`) mistura de volta o original na intensidade
 * escolhida e fecha o portao quando nao ha voz. O compressor e o nivelador.
 *
 * Este arquivo e carregado sob demanda por `midia.ts`: quem nunca fala nao
 * baixa modelo nenhum.
 */

export type ModeloDeIa = 'rnnoise' | 'gtcrn' | 'dfn3'

export type AjusteDaVoz = {
  /** `null`: sem rede neural — so portao e nivelador, se ligados. */
  modelo: ModeloDeIa | null
  /** 0 a 100. Quanto da limpeza da rede vale; o resto e o som original. */
  intensidade: number
  portao: AjusteDoPortao
  /** Compressor com ganho: sobe quem fala baixo, segura quem grita. */
  nivelador: boolean
}

export type MedidaDaVoz = Omit<MedidaDoWorklet, 'tipo'>

/**
 * O modelo pedido nao pode ser carregado NESTE servidor.
 *
 * Distinto de uma falha qualquer porque pede outra reacao: o DeepFilterNet3 e
 * baixado no build, e um build que nao conseguiu baixa-lo serve 404. Ai a
 * chamada cai para o `gtcrn`, que vem empacotado, em vez de ficar sem nada.
 */
export class ModeloIndisponivel extends Error {
  constructor(readonly modelo: ModeloDeIa, causa?: unknown) {
    super(`modelo ${modelo} indisponivel`, { cause: causa })
    this.name = 'ModeloIndisponivel'
  }
}

/** Onde o build deixa o DeepFilterNet3 — ver `web/scripts/modelo-dfn3.mjs`. */
const DFN3 = {
  worklet: '/modelos/dfn3/worklet.js',
  wasm: '/modelos/dfn3/df_bg.wasm',
  modelo: '/modelos/dfn3/DeepFilterNet3_onnx.tar.gz',
}

type AtivosDfn3 = { wasm: WebAssembly.Module; modelo: ArrayBuffer }

/** O binario de cada modelo, baixado uma vez por aba. */
const binarios: Partial<Record<'rnnoise' | 'gtcrn', Promise<ArrayBuffer>>> = {}
let ativosDfn3: Promise<AtivosDfn3> | null = null

/**
 * Os worklets registrados em cada contexto.
 *
 * `addModule` duas vezes no mesmo contexto registra o processador de novo e o
 * navegador reclama que o nome ja existe; por isso a memoria e POR contexto.
 */
const registrados = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>()

async function memorizado<T>(
  ler: () => Promise<T> | null | undefined,
  gravar: (p: Promise<T> | null) => void,
  criar: () => Promise<T>,
): Promise<T> {
  let pendente = ler()
  if (pendente === null || pendente === undefined) {
    pendente = criar()
    gravar(pendente)
  }
  try {
    return await pendente
  } catch (erro) {
    // Uma falha de rede nao pode ficar memorizada para sempre: a proxima
    // chamada tenta baixar de novo.
    gravar(null)
    throw erro
  }
}

async function binario(modelo: 'rnnoise' | 'gtcrn'): Promise<ArrayBuffer> {
  return memorizado(
    () => binarios[modelo],
    p => { if (p === null) delete binarios[modelo]; else binarios[modelo] = p },
    async () => {
      const lib = await import('@sapphi-red/web-noise-suppressor')
      return modelo === 'rnnoise'
        ? lib.loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseWasmSimd })
        : lib.loadGtcrn({ url: gtcrnWasm })
    },
  )
}

async function baixar(url: string): Promise<ArrayBuffer> {
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`${url}: HTTP ${String(resposta.status)}`)
  return resposta.arrayBuffer()
}

async function carregarDfn3(): Promise<AtivosDfn3> {
  try {
    return await memorizado(
      () => ativosDfn3,
      p => { ativosDfn3 = p },
      async () => {
        const [bytes, modelo] = await Promise.all([baixar(DFN3.wasm), baixar(DFN3.modelo)])
        return { wasm: await WebAssembly.compile(bytes), modelo }
      },
    )
  } catch (erro) {
    throw new ModeloIndisponivel('dfn3', erro)
  }
}

function registrar(contexto: BaseAudioContext, chave: string, url: string): Promise<void> {
  let doContexto = registrados.get(contexto)
  if (doContexto === undefined) {
    doContexto = new Map()
    registrados.set(contexto, doContexto)
  }
  let pendente = doContexto.get(chave)
  if (pendente === undefined) {
    pendente = contexto.audioWorklet.addModule(url)
    doContexto.set(chave, pendente)
    // Um addModule que falhou nao pode ficar memorizado: o proximo tenta de novo.
    pendente.catch(() => { doContexto.delete(chave) })
  }
  return pendente
}

/** A intensidade, de 0-100 para o limite de atenuacao do DeepFilterNet3, em dB. */
function limiteDeAtenuacao(intensidade: number): number {
  return Math.round(Math.min(100, Math.max(0, intensidade)))
}

type Rede = { no: AudioNode; destruir: () => void; ajustarIntensidade?: (i: number) => void }

async function criarRede(contexto: AudioContext, modelo: ModeloDeIa, intensidade: number): Promise<Rede> {
  if (modelo === 'dfn3') {
    const [ativos] = await Promise.all([
      carregarDfn3(),
      registrar(contexto, 'dfn3', DFN3.worklet).catch((erro: unknown) => {
        throw new ModeloIndisponivel('dfn3', erro)
      }),
    ])
    const no = new AudioWorkletNode(contexto, 'deepfilter-audio-processor', {
      processorOptions: {
        wasmModule: ativos.wasm,
        modelBytes: ativos.modelo,
        suppressionLevel: limiteDeAtenuacao(intensidade),
      },
    })
    return {
      no,
      destruir: () => { no.disconnect(); no.port.close() },
      // O DeepFilterNet3 tem a intensidade nativa: um teto de atenuacao em
      // dB. E melhor que a mistura, porque age por faixa de frequencia.
      ajustarIntensidade: i => {
        no.port.postMessage({ type: 'SET_SUPPRESSION_LEVEL', value: limiteDeAtenuacao(i) })
      },
    }
  }

  const [wasmBinary, lib] = await Promise.all([
    binario(modelo),
    import('@sapphi-red/web-noise-suppressor'),
    registrar(contexto, modelo, modelo === 'rnnoise' ? rnnoiseWorklet : gtcrnWorklet),
  ])
  const no = modelo === 'rnnoise'
    ? new lib.RnnoiseWorkletNode(contexto, { wasmBinary, maxChannels: 1 })
    : new lib.GtcrnWorkletNode(contexto, { wasmBinary, maxChannels: 1 })
  return { no, destruir: () => { no.disconnect(); no.destroy() } }
}

/** O nivelador: compressor 4:1 a partir de -30 dB e +10 dB de ganho de volta. */
function regularNivelador(compressor: DynamicsCompressorNode, ganho: GainNode, ligado: boolean): void {
  compressor.threshold.value = ligado ? -30 : 0
  compressor.ratio.value = ligado ? 4 : 1
  ganho.gain.value = ligado ? 10 ** (10 / 20) : 1
}

export type Cadeia = {
  saida: MediaStreamTrack
  /** Muda tudo o que nao exige trocar a rede. Vale no bloco seguinte. */
  ajustar: (ajuste: Partial<Omit<AjusteDaVoz, 'modelo'>>) => void
  desmontar: () => void
}

/**
 * Monta a cadeia inteira sobre uma faixa de microfone.
 *
 * Usada pela chamada (via `ProcessadorDeVoz`, que o LiveKit pluga) e pelo
 * teste de microfone das configuracoes — o mesmo grafo nos dois, para que o
 * "depois" do teste seja exatamente o que a sala ouve.
 */
export async function montarCadeia(
  contexto: AudioContext,
  entrada: MediaStreamTrack,
  ajuste: AjusteDaVoz,
  aoMedir?: (medida: MedidaDaVoz) => void,
): Promise<Cadeia> {
  // O contexto nasce suspenso fora de um gesto. Entrar na chamada vem de um
  // clique, entao aqui o `resume` costuma valer; se nao valer, o som passa a
  // fluir no primeiro gesto seguinte, que o `destravarSons` ja provoca.
  if (contexto.state === 'suspended') await contexto.resume().catch(() => undefined)

  const [rede] = await Promise.all([
    ajuste.modelo === null ? null : criarRede(contexto, ajuste.modelo, ajuste.intensidade),
    registrar(contexto, 'altcast-voz', vozWorklet),
  ])

  const fonte = contexto.createMediaStreamSource(new MediaStream([entrada]))

  // Corta abaixo de 80 Hz antes da rede: e onde mora o ronco da mesa, o
  // pe batendo e o vento no microfone. Nenhuma voz humana vive ali, e o
  // modelo trabalha melhor sem ter de gastar capacidade com isso.
  const graves = contexto.createBiquadFilter()
  graves.type = 'highpass'
  graves.frequency.value = 80

  // A mistura so existe para as redes sem intensidade propria.
  const misturaPropria = rede !== null && rede.ajustarIntensidade === undefined
  const opcoes: OpcoesDoWorklet = {
    intensidade: misturaPropria ? ajuste.intensidade / 100 : 1,
    portao: ajuste.portao,
    alinhar: misturaPropria,
  }
  const voz = new AudioWorkletNode(contexto, 'altcast-voz', {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: opcoes,
  })
  if (aoMedir !== undefined) {
    voz.port.onmessage = (evento: MessageEvent<MedidaDoWorklet>) => {
      const { tipo: _tipo, ...medida } = evento.data
      aoMedir(medida)
    }
  }

  const compressor = contexto.createDynamicsCompressor()
  compressor.knee.value = 12
  compressor.attack.value = 0.004
  compressor.release.value = 0.25
  const ganho = contexto.createGain()
  regularNivelador(compressor, ganho, ajuste.nivelador)

  // O limitador fica sempre: com o nivelador desligado ele so encosta em
  // pico de verdade, e com ele ligado impede o ganho de estourar.
  const limitador = contexto.createDynamicsCompressor()
  limitador.threshold.value = -3
  limitador.knee.value = 0
  limitador.ratio.value = 20
  limitador.attack.value = 0.001
  limitador.release.value = 0.1

  const destino = contexto.createMediaStreamDestination()

  fonte.connect(graves)
  if (rede === null) {
    graves.connect(voz, 0, 0)
  } else {
    graves.connect(rede.no).connect(voz, 0, 0)
    graves.connect(voz, 0, 1)
  }
  voz.connect(compressor).connect(ganho).connect(limitador).connect(destino)

  const saida = destino.stream.getAudioTracks()[0]
  if (saida === undefined) throw new Error('o destino de audio nao produziu faixa')

  return {
    saida,
    ajustar: mudanca => {
      const mensagem: MensagemParaOWorklet = { tipo: 'ajustar' }
      if (mudanca.intensidade !== undefined) {
        if (rede?.ajustarIntensidade !== undefined) rede.ajustarIntensidade(mudanca.intensidade)
        else if (misturaPropria) mensagem.intensidade = mudanca.intensidade / 100
      }
      if (mudanca.portao !== undefined) mensagem.portao = mudanca.portao
      if (mensagem.intensidade !== undefined || mensagem.portao !== undefined) {
        voz.port.postMessage(mensagem)
      }
      if (mudanca.nivelador !== undefined) regularNivelador(compressor, ganho, mudanca.nivelador)
    },
    desmontar: () => {
      fonte.disconnect()
      graves.disconnect()
      rede?.destruir()
      voz.disconnect()
      voz.port.close()
      compressor.disconnect()
      ganho.disconnect()
      limitador.disconnect()
      saida.stop()
    },
  }
}

/**
 * O processador que o LiveKit pluga no microfone.
 *
 * A forma segue `TrackProcessor` do SDK: `init` monta o grafo e expoe a faixa
 * tratada em `processedTrack`, que e o que o SDK passa a publicar; `restart` e
 * chamado quando o microfone e trocado no meio da chamada; `destroy`, quando
 * o tratamento e desligado ou a chamada acaba.
 */
export type ProcessadorDeVoz = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
  ajustar: (ajuste: Partial<Omit<AjusteDaVoz, 'modelo'>>) => void
}

export function criarProcessadorDeVoz(
  ajuste: AjusteDaVoz,
  aoMedir?: (medida: MedidaDaVoz) => void,
): ProcessadorDeVoz {
  return new Processador(ajuste, aoMedir)
}

class Processador implements ProcessadorDeVoz {
  readonly name: string
  processedTrack?: MediaStreamTrack
  private cadeia: Cadeia | null = null
  private ajuste: AjusteDaVoz

  constructor(ajuste: AjusteDaVoz, private readonly aoMedir?: (medida: MedidaDaVoz) => void) {
    this.ajuste = ajuste
    this.name = `altcast-voz-${ajuste.modelo ?? 'sem-rede'}`
  }

  async init(opcoes: AudioProcessorOptions): Promise<void> {
    this.cadeia = await montarCadeia(opcoes.audioContext, opcoes.track, this.ajuste, this.aoMedir)
    this.processedTrack = this.cadeia.saida
  }

  async restart(opcoes: AudioProcessorOptions): Promise<void> {
    this.desmontar()
    await this.init(opcoes)
  }

  destroy(): Promise<void> {
    this.desmontar()
    return Promise.resolve()
  }

  ajustar(mudanca: Partial<Omit<AjusteDaVoz, 'modelo'>>): void {
    this.ajuste = { ...this.ajuste, ...mudanca }
    this.cadeia?.ajustar(mudanca)
  }

  private desmontar(): void {
    this.cadeia?.desmontar()
    this.cadeia = null
    delete this.processedTrack
  }
}

/**
 * A limpeza do audio que CHEGA: os nos que o LiveKit insere entre a faixa
 * remota e o alto-falante (`setWebAudioPlugins`). Uma rede por pessoa — o
 * estado da rede e a voz de alguem, e misturar duas vozes no mesmo estado
 * estragaria as duas.
 *
 * Sempre o `gtcrn`: ele vem empacotado (nao depende do download do build) e
 * custa uma fracao do DeepFilterNet3, o que importa quando sao varias pessoas.
 */
export async function criarLimpezaDeEscuta(
  contexto: AudioContext,
): Promise<{ nos: AudioNode[]; desmontar: () => void }> {
  const rede = await criarRede(contexto, 'gtcrn', 100)
  const graves = contexto.createBiquadFilter()
  graves.type = 'highpass'
  graves.frequency.value = 80
  return {
    nos: [graves, rede.no],
    desmontar: () => {
      graves.disconnect()
      rede.destruir()
    },
  }
}
