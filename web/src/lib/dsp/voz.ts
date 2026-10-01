/**
 * O tratamento da voz que roda DEPOIS da rede neural, bloco a bloco.
 *
 * Tres pecas, todas sem dependencia de navegador — elas sao executadas dentro
 * de um AudioWorklet (`vozWorklet.ts`), mas aqui sao so contas sobre
 * `Float32Array`, e por isso o teste as exercita com sinal sintetico:
 *
 * - `Alinhador`: descobre o atraso que a rede neural introduz. Sem ele, a
 *   mistura de "intensidade" somaria o som original com uma copia atrasada
 *   dele mesmo, e o resultado soaria como voz dentro de um cano (filtro pente).
 * - `misturar`: a intensidade da limpeza. 100% e so a saida da rede; 60% deixa
 *   voltar 40% do som original, ja alinhado — para quem acha a voz "robotica".
 * - `Portao`: a sensibilidade de entrada do Discord. Fecha o microfone quando
 *   nao ha voz, com o limiar decidido sozinho (pelo piso de ruido) ou a mao.
 */

/** O bloco do AudioWorklet: o navegador entrega 128 amostras por vez. */
export const BLOCO = 128

/** Abaixo disto e silencio digital: evita `log10(0)` e o -Infinity. */
const PISO_ABSOLUTO_DB = -100

export function nivelDb(bloco: Float32Array): number {
  let soma = 0
  for (let i = 0; i < bloco.length; i++) {
    const v = bloco[i] ?? 0
    soma += v * v
  }
  const rms = Math.sqrt(soma / Math.max(1, bloco.length))
  return rms <= 0 ? PISO_ABSOLUTO_DB : Math.max(PISO_ABSOLUTO_DB, 20 * Math.log10(rms))
}

export type ModoDoPortao = 'desligado' | 'automatico' | 'manual'

export type AjusteDoPortao = {
  modo: ModoDoPortao
  /** Usado so no modo manual, em dBFS. */
  limiarDb: number
}

/**
 * O portao de ruido com limiar automatico.
 *
 * O automatico mede o PISO de ruido — o nivel do ambiente quando ninguem fala
 * — pelo metodo do minimo: desce rapido quando o nivel cai, e sobe devagar,
 * para que uma frase longa nao seja confundida com ambiente. O limiar fica uma
 * margem acima do piso. Com a rede neural na frente o piso e muito baixo, e a
 * voz abre o portao com folga; sem ela, o piso e o ventilador, e o limiar
 * acompanha.
 *
 * Abrir e instantaneo (a primeira silaba nao pode ser cortada), fechar espera
 * `seguraMs` e desce em rampa: o fim das palavras tem pouca energia, e um
 * portao que fecha seco corta o "s" final.
 */
export class Portao {
  private ajuste: AjusteDoPortao
  private pisoDb = -60
  private nivelSuave = PISO_ABSOLUTO_DB
  private blocosAbaixo = 0
  private ganho = 1
  private aberto = true
  private readonly margemDb: number
  private readonly blocosDeSegura: number
  /** Quanto o ganho anda por amostra ao fechar: rampa de `soltaMs`. */
  private readonly passoDeSolta: number
  /** Ao abrir: rampa curta de ~2 ms, so para nao estalar. */
  private readonly passoDeAtaque: number

  constructor(
    ajuste: AjusteDoPortao,
    taxa = 48_000,
    { seguraMs = 280, soltaMs = 80, margemDb = 14 }: {
      seguraMs?: number; soltaMs?: number; margemDb?: number
    } = {},
  ) {
    this.ajuste = ajuste
    this.margemDb = margemDb
    this.blocosDeSegura = Math.max(1, Math.round((seguraMs / 1000) * taxa / BLOCO))
    this.passoDeSolta = 1 / Math.max(1, (soltaMs / 1000) * taxa)
    this.passoDeAtaque = 1 / Math.max(1, 0.002 * taxa)
  }

  ajustar(ajuste: AjusteDoPortao): void {
    this.ajuste = ajuste
    if (ajuste.modo === 'desligado') {
      this.aberto = true
      this.blocosAbaixo = 0
    }
  }

  /** O limiar em vigor: o manual, ou o piso medido mais a margem. */
  limiarDb(): number {
    if (this.ajuste.modo === 'manual') return this.ajuste.limiarDb
    // Nunca abaixo de -70: perto do silencio digital, o "piso" e so o
    // arredondamento do conversor, e um limiar ali abriria com respiracao.
    // Nunca acima de -30: um ambiente barulhento nao pode exigir grito.
    return Math.min(-30, Math.max(-70, this.pisoDb + this.margemDb))
  }

  estaAberto(): boolean { return this.aberto }

  nivel(): number { return this.nivelSuave }

  /** Processa o bloco no lugar. Devolve o nivel medido, em dB. */
  processar(bloco: Float32Array): number {
    const medido = nivelDb(bloco)
    // Ataque rapido, queda lenta: o medidor acompanha a voz sem tremer.
    this.nivelSuave = medido > this.nivelSuave ? medido : this.nivelSuave * 0.85 + medido * 0.15

    // O piso: desce junto, sobe ~2 dB por segundo (0,005 dB por bloco a 48 kHz).
    if (medido < this.pisoDb) this.pisoDb = this.pisoDb * 0.5 + medido * 0.5
    else this.pisoDb += 0.005

    if (this.ajuste.modo === 'desligado') {
      this.rampa(bloco, 1)
      return this.nivelSuave
    }

    const limiar = this.limiarDb()
    if (medido >= limiar) {
      this.aberto = true
      this.blocosAbaixo = 0
    } else if (this.aberto && medido < limiar - 4) {
      // Histerese de 4 dB: a voz oscilando em torno do limiar nao picota.
      this.blocosAbaixo += 1
      if (this.blocosAbaixo >= this.blocosDeSegura) this.aberto = false
    }
    this.rampa(bloco, this.aberto ? 1 : 0)
    return this.nivelSuave
  }

  private rampa(bloco: Float32Array, alvo: number): void {
    for (let i = 0; i < bloco.length; i++) {
      if (this.ganho < alvo) this.ganho = Math.min(alvo, this.ganho + this.passoDeAtaque)
      else if (this.ganho > alvo) this.ganho = Math.max(alvo, this.ganho - this.passoDeSolta)
      bloco[i] = (bloco[i] ?? 0) * this.ganho
    }
  }
}

/**
 * Acha o atraso, em amostras, entre o som original e a saida da rede.
 *
 * Correlacao cruzada acumulada so nos blocos COM voz (no silencio a rede
 * devolve zero, e zero nao correlaciona com nada). Testar todos os atrasos a
 * cada bloco custaria tempo demais na thread de audio, que divide os 2,7 ms do
 * bloco com a propria rede; por isso cada bloco testa uma FATIA dos atrasos,
 * em rodizio. Com 1024 por bloco e 4096 no total, cada atraso recebe um quarto
 * dos blocos de voz — e em torno de um segundo e meio de fala ele trava.
 */
export class Alinhador {
  private readonly historico: Float32Array
  private escrita = 0
  private readonly soma: Float64Array
  private readonly amostrasPorAtraso: Uint32Array
  private proximaFatia = 0
  private achado: number | null = null

  constructor(
    private readonly maximo = 4096,
    private readonly porBloco = 1024,
    private readonly blocosParaDecidir = 120,
  ) {
    this.historico = new Float32Array(maximo + BLOCO)
    this.soma = new Float64Array(maximo + 1)
    this.amostrasPorAtraso = new Uint32Array(maximo + 1)
  }

  atraso(): number | null { return this.achado }

  /** Guarda o original e, se houver voz, acumula a correlacao de uma fatia. */
  empurrar(seco: Float32Array, limpo: Float32Array, temVoz: boolean): void {
    const n = this.historico.length
    for (let i = 0; i < seco.length; i++) {
      this.historico[this.escrita] = seco[i] ?? 0
      this.escrita = (this.escrita + 1) % n
    }
    if (this.achado !== null || !temVoz) return

    const inicio = this.proximaFatia
    const fim = Math.min(this.maximo, inicio + this.porBloco - 1)
    // `escrita` aponta para depois da ultima amostra; a amostra i do bloco
    // atual mora em escrita - BLOCO + i.
    const base = this.escrita - seco.length
    for (let atraso = inicio; atraso <= fim; atraso++) {
      let acc = 0
      for (let i = 0; i < limpo.length; i++) {
        const j = (((base + i - atraso) % n) + n) % n
        acc += (limpo[i] ?? 0) * (this.historico[j] ?? 0)
      }
      this.soma[atraso] = (this.soma[atraso] ?? 0) + acc
      this.amostrasPorAtraso[atraso] = (this.amostrasPorAtraso[atraso] ?? 0) + 1
    }
    this.proximaFatia = fim + 1 > this.maximo ? 0 : fim + 1
    if (this.proximaFatia === 0) this.tentarDecidir()
  }

  private tentarDecidir(): void {
    let minimo = Infinity
    for (let a = 0; a <= this.maximo; a++) minimo = Math.min(minimo, this.amostrasPorAtraso[a] ?? 0)
    if (minimo < this.blocosParaDecidir) return

    let melhor = 0
    let valor = -Infinity
    for (let a = 0; a <= this.maximo; a++) {
      const media = (this.soma[a] ?? 0) / (this.amostrasPorAtraso[a] ?? 1)
      if (media > valor) { valor = media; melhor = a }
    }
    // O segundo pico, fora da vizinhanca do primeiro: voz e periodica, e o
    // atraso de um periodo de pitch tambem correlaciona. So decide quando o
    // vencedor vence com folga; senao recomeca, com mais fala.
    let segundo = -Infinity
    for (let a = 0; a <= this.maximo; a++) {
      if (Math.abs(a - melhor) < 48) continue
      segundo = Math.max(segundo, (this.soma[a] ?? 0) / (this.amostrasPorAtraso[a] ?? 1))
    }
    if (valor > 0 && valor > segundo * 1.15) {
      this.achado = melhor
      return
    }
    this.soma.fill(0)
    this.amostrasPorAtraso.fill(0)
  }

  /** Copia em `destino` o original atrasado de `atraso` amostras. */
  lerAtrasado(destino: Float32Array, atraso: number): void {
    const n = this.historico.length
    const base = this.escrita - destino.length
    for (let i = 0; i < destino.length; i++) {
      destino[i] = this.historico[(((base + i - atraso) % n) + n) % n] ?? 0
    }
  }
}

/**
 * A intensidade da limpeza: `limpo * k + original * (1 - k)`, no lugar, em
 * `limpo`. Com k = 1 nao toca em nada — o caminho comum fica sem custo.
 */
export function misturar(limpo: Float32Array, originalAlinhado: Float32Array, k: number): void {
  if (k >= 1) return
  const resto = 1 - k
  for (let i = 0; i < limpo.length; i++) {
    limpo[i] = (limpo[i] ?? 0) * k + (originalAlinhado[i] ?? 0) * resto
  }
}
