import { lerPreferencias, lerProcessamento, modeloDaSupressao, precisaDeCadeia } from './midia.js'
import type { ModeloDeIa } from './midia.js'

/**
 * O teste de microfone das configuracoes: alguns segundos gravados duas vezes
 * ao mesmo tempo — o microfone cru e o mesmo som depois da cadeia inteira.
 *
 * As duas gravacoes saem do MESMO instante de fala, e nao de duas tentativas:
 * comparar "antes" e "depois" gravados em momentos diferentes compararia dois
 * barulhos de fundo diferentes, e a diferenca que importa sumiria.
 *
 * A cadeia e a mesma `montarCadeia` da chamada, com as escolhas guardadas. O
 * "depois" e literalmente o que a sala ouviria.
 */

export type Gravacao = {
  /** URLs `blob:` para os dois `<audio>`. */
  original: string
  tratado: string
  /** A rede que de fato tratou — difere da escolha quando a alta qualidade falta. */
  modelo: ModeloDeIa | null
  liberar: () => void
}

export function testeDisponivel(): boolean {
  return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined
    && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined'
    && typeof AudioWorkletNode !== 'undefined'
}

function gravar(faixa: MediaStreamTrack): { parar: () => Promise<Blob> } {
  const gravador = new MediaRecorder(new MediaStream([faixa]))
  const pedacos: Blob[] = []
  gravador.ondataavailable = e => { if (e.data.size > 0) pedacos.push(e.data) }
  gravador.start()
  return {
    parar: () => new Promise(resolver => {
      gravador.onstop = () => { resolver(new Blob(pedacos, { type: gravador.mimeType })) }
      gravador.stop()
    }),
  }
}

export async function gravarTesteDeMicrofone(
  segundos: number,
  aoProgredir?: (fracao: number) => void,
): Promise<Gravacao> {
  const tratamento = lerProcessamento()
  const preferido = lerPreferencias().audioinput
  const captura = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(preferido === undefined ? {} : { deviceId: preferido }),
      echoCancellation: tratamento.eco,
      autoGainControl: tratamento.ganho,
      noiseSuppression: tratamento.supressao === 'navegador',
    },
  })
  const cru = captura.getAudioTracks()[0]
  if (cru === undefined) throw new Error('o microfone nao entregou faixa de audio')

  const contexto = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
  let desmontar = (): void => undefined
  try {
    let tratada = cru
    let modelo = modeloDaSupressao(tratamento.supressao)
    if (precisaDeCadeia(tratamento)) {
      const cadeia = await import('./supressao.js')
      const montar = (m: ModeloDeIa | null): ReturnType<typeof cadeia.montarCadeia> =>
        cadeia.montarCadeia(contexto, cru, {
          modelo: m,
          intensidade: tratamento.intensidade,
          portao: { modo: tratamento.portao, limiarDb: tratamento.limiarDb },
          nivelador: tratamento.nivelador,
        })
      let montada
      try {
        montada = await montar(modelo)
      } catch (erro) {
        if (modelo !== 'dfn3' || !(erro instanceof cadeia.ModeloIndisponivel)) throw erro
        modelo = 'gtcrn'
        montada = await montar(modelo)
      }
      tratada = montada.saida
      desmontar = montada.desmontar
    }

    const antes = gravar(cru)
    const depois = gravar(tratada)
    const inicio = performance.now()
    await new Promise<void>(resolver => {
      const relogio = setInterval(() => {
        const fracao = Math.min(1, (performance.now() - inicio) / (segundos * 1000))
        aoProgredir?.(fracao)
        if (fracao >= 1) { clearInterval(relogio); resolver() }
      }, 100)
    })
    const [blobAntes, blobDepois] = await Promise.all([antes.parar(), depois.parar()])
    const original = URL.createObjectURL(blobAntes)
    const tratado = URL.createObjectURL(blobDepois)
    return {
      original,
      tratado,
      modelo,
      liberar: () => {
        URL.revokeObjectURL(original)
        URL.revokeObjectURL(tratado)
      },
    }
  } finally {
    desmontar()
    for (const faixa of captura.getTracks()) faixa.stop()
    void contexto.close().catch(() => undefined)
  }
}
