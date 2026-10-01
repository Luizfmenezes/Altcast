/**
 * O AudioWorklet do tratamento de voz: intensidade, portao e medidor.
 *
 * Empacotado pelo Vite como modulo proprio (`?worker&url` em `supressao.ts`),
 * porque um AudioWorklet so carrega por URL — e precisa ser uma URL do proprio
 * site: a CSP nao aceita `blob:` como script.
 *
 * Entradas: [0] a saida da rede neural (ou o microfone, sem rede); [1] o
 * microfone original, para a mistura da intensidade. Saida: uma, mono.
 */
import { Alinhador, BLOCO, misturar, nivelDb, Portao } from './voz.js'
import type { AjusteDoPortao } from './voz.js'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  nome: string,
  construtor: new (opcoes: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void

export type OpcoesDoWorklet = {
  intensidade: number
  portao: AjusteDoPortao
  /** Sem rede neural nao ha o que alinhar nem misturar. */
  alinhar: boolean
}

export type MensagemParaOWorklet = {
  tipo: 'ajustar'
  intensidade?: number
  portao?: AjusteDoPortao
}

export type MedidaDoWorklet = {
  tipo: 'medida'
  nivelDb: number
  limiarDb: number
  aberto: boolean
  /**
   * O atraso da rede ja calibrado, em amostras — `null` enquanto a mistura
   * da intensidade ainda nao tem como alinhar. Diagnostico: e por ele que se
   * ve que a intensidade abaixo de 100% esta valendo.
   */
  atraso: number | null
}

/** ~16 medidas por segundo a 48 kHz: o bastante para o medidor parecer vivo. */
const BLOCOS_POR_MEDIDA = 24

class ProcessadorDeVoz extends AudioWorkletProcessor {
  private intensidade: number
  private readonly alinhar: boolean
  private readonly portao: Portao
  private readonly alinhador = new Alinhador()
  private readonly atrasado = new Float32Array(BLOCO)
  private contador = 0

  constructor(opcoes: { processorOptions?: unknown }) {
    super()
    const o = opcoes.processorOptions as OpcoesDoWorklet
    this.intensidade = o.intensidade
    this.alinhar = o.alinhar
    this.portao = new Portao(o.portao, sampleRate)
    this.port.onmessage = (evento: MessageEvent<MensagemParaOWorklet>) => {
      const m = evento.data
      if (m.tipo !== 'ajustar') return
      if (typeof m.intensidade === 'number') this.intensidade = Math.min(1, Math.max(0, m.intensidade))
      if (m.portao !== undefined) this.portao.ajustar(m.portao)
    }
  }

  process(entradas: Float32Array[][], saidas: Float32Array[][]): boolean {
    const saida = saidas[0]?.[0]
    if (saida === undefined) return true
    const limpo = entradas[0]?.[0]
    if (limpo === undefined) {
      saida.fill(0)
      return true
    }
    saida.set(limpo)

    const seco = entradas[1]?.[0]
    if (this.alinhar && seco !== undefined) {
      // So calibra quando a intensidade sai dos 100%: quem nunca mexe no
      // controle nao paga a correlacao.
      const calibrar = this.intensidade < 1 && nivelDb(limpo) > -55
      this.alinhador.empurrar(seco, limpo, calibrar)
      const atraso = this.alinhador.atraso()
      if (this.intensidade < 1 && atraso !== null) {
        this.alinhador.lerAtrasado(this.atrasado, atraso)
        misturar(saida, this.atrasado, this.intensidade)
      }
    }

    // Os outros canais da saida (se o navegador pedir estereo) recebem o mesmo.
    this.portao.processar(saida)
    for (let c = 1; c < (saidas[0]?.length ?? 0); c++) saidas[0]?.[c]?.set(saida)

    this.contador = (this.contador + 1) % BLOCOS_POR_MEDIDA
    if (this.contador === 0) {
      const medida: MedidaDoWorklet = {
        tipo: 'medida',
        nivelDb: this.portao.nivel(),
        limiarDb: this.portao.limiarDb(),
        aberto: this.portao.estaAberto(),
        atraso: this.alinhar ? this.alinhador.atraso() : null,
      }
      this.port.postMessage(medida)
    }
    return true
  }
}

registerProcessor('altcast-voz', ProcessadorDeVoz)
