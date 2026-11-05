import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import type { AtividadeMontada } from './atividade'

/**
 * O cliente do Rich Presence, falando o protocolo IPC do Discord direto.
 *
 * O Discord aberto no PC escuta num pipe nomeado (`\\?\pipe\discord-ipc-N`, de 0
 * a 9 — o numero sobe quando ha mais de um Discord, como o Canary). Por ele
 * passam quadros de `[opcode u32 LE][tamanho u32 LE][JSON]`: um HANDSHAKE com o
 * Client ID, a resposta READY, e dai em diante SET_ACTIVITY. E o protocolo
 * inteiro que o Altcast usa, e cabe neste arquivo — uma biblioteca traria um
 * cliente de RPC completo, com dependencias, para mandar um unico comando.
 *
 * O Discord pode abrir depois do Altcast, fechar no meio da chamada ou nem
 * estar instalado. Nenhum desses casos e erro: o cliente tenta de novo de
 * tempos em tempos enquanto houver atividade para mostrar, e fica quieto
 * quando nao ha.
 */

export const OP = { handshake: 0, quadro: 1, fechar: 2, ping: 3, pong: 4 } as const

type Quadro = { op: number; dados: unknown }

export function codificar(op: number, dados: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(dados), 'utf8')
  const cabecalho = Buffer.alloc(8)
  cabecalho.writeInt32LE(op, 0)
  cabecalho.writeInt32LE(json.length, 4)
  return Buffer.concat([cabecalho, json])
}

/**
 * Le os quadros COMPLETOS do que chegou e devolve o resto.
 *
 * Um `data` do socket nao e um quadro: pode trazer meio, ou dois e meio. O
 * resto volta para ser somado ao proximo pedaco.
 */
export function decodificar(acumulado: Buffer): { quadros: Quadro[]; resto: Buffer } {
  const quadros: Quadro[] = []
  let posicao = 0
  while (acumulado.length - posicao >= 8) {
    const op = acumulado.readInt32LE(posicao)
    const tamanho = acumulado.readInt32LE(posicao + 4)
    if (acumulado.length - posicao - 8 < tamanho) break
    const corpo = acumulado.subarray(posicao + 8, posicao + 8 + tamanho).toString('utf8')
    let dados: unknown = null
    try { dados = JSON.parse(corpo) } catch { /* quadro torto vira `null`, e e ignorado */ }
    quadros.push({ op, dados })
    posicao += 8 + tamanho
  }
  return { quadros, resto: acumulado.subarray(posicao) }
}

/** Onde o Discord escuta, na ordem em que vale tentar. */
export function caminhosDoDiscord(
  plataforma: NodeJS.Platform = process.platform,
  ambiente: NodeJS.ProcessEnv = process.env,
): string[] {
  const numeros = Array.from({ length: 10 }, (_, i) => i)
  if (plataforma === 'win32') return numeros.map(i => `\\\\?\\pipe\\discord-ipc-${String(i)}`)
  const base = ambiente.XDG_RUNTIME_DIR ?? ambiente.TMPDIR ?? ambiente.TMP ?? ambiente.TEMP ?? '/tmp'
  return numeros.map(i => `${base.replace(/\/$/, '')}/discord-ipc-${String(i)}`)
}

export type OpcoesDoCliente = {
  caminhos?: () => string[]
  pid?: number
  /** Intervalo entre tentativas quando o Discord nao esta aberto. */
  esperaMs?: number
  /**
   * O Discord aceita 5 SET_ACTIVITY a cada 20 segundos e descarta o resto em
   * silencio. Mudancas mais proximas que isto sao juntadas, e vale a ultima.
   */
  intervaloMinimoMs?: number
}

export type ClienteDoDiscord = {
  /** O que mostrar agora; `null` limpa o cartao. */
  definir: (atividade: AtividadeMontada | null) => void
  encerrar: () => void
}

export function criarClienteDoDiscord(opcoes: OpcoesDoCliente = {}): ClienteDoDiscord {
  const caminhos = opcoes.caminhos ?? (() => caminhosDoDiscord())
  const pid = opcoes.pid ?? process.pid
  const esperaMs = opcoes.esperaMs ?? 15_000
  const intervaloMinimoMs = opcoes.intervaloMinimoMs ?? 4_000

  let desejada: AtividadeMontada | null = null
  let socket: Socket | null = null
  let clientIdDoSocket: string | null = null
  let pronto = false
  let conectando = false
  let encerrado = false
  let acumulado: Buffer = Buffer.alloc(0)
  let ultimoEnvio = 0
  let tentativa: NodeJS.Timeout | null = null
  let envioAdiado: NodeJS.Timeout | null = null

  function derrubar(): void {
    if (socket !== null) {
      socket.removeAllListeners()
      // Um `error` depois de remover os ouvintes derrubaria o processo
      // principal inteiro como excecao nao tratada.
      socket.on('error', () => undefined)
      socket.destroy()
    }
    socket = null
    clientIdDoSocket = null
    pronto = false
    acumulado = Buffer.alloc(0)
  }

  function agendarTentativa(): void {
    if (encerrado || desejada === null || tentativa !== null) return
    tentativa = setTimeout(() => {
      tentativa = null
      void conectar()
    }, esperaMs)
    // Um timer pendurado nao pode segurar o app aberto depois de fechar a janela.
    tentativa.unref()
  }

  function abrir(caminho: string): Promise<Socket> {
    return new Promise((resolver, rejeitar) => {
      const s = connect(caminho)
      s.once('connect', () => {
        s.removeAllListeners('error')
        resolver(s)
      })
      s.once('error', rejeitar)
    })
  }

  async function conectar(): Promise<void> {
    if (encerrado || desejada === null || socket !== null || conectando) return
    conectando = true
    const clientId = desejada.clientId
    let conectou = false
    try {
      for (const caminho of caminhos()) {
        let s: Socket
        try {
          s = await abrir(caminho)
        } catch {
          continue
        }
        if (encerrado) {
          s.destroy()
          return
        }
        socket = s
        clientIdDoSocket = clientId
        s.on('data', receber)
        s.on('error', () => undefined) // o `close` que vem junto e quem trata
        s.on('close', () => {
          derrubar()
          agendarTentativa()
        })
        s.write(codificar(OP.handshake, { v: 1, client_id: clientId }))
        conectou = true
        break
      }
    } finally {
      conectando = false
    }
    if (!conectou) {
      agendarTentativa()
      return
    }
    // O pedido mudou de Client ID enquanto o pipe abria: este handshake ja
    // nao serve, e o certo e recomecar com o ID novo.
    if (desejada !== null && desejada.clientId !== clientId) {
      derrubar()
      void conectar()
    }
  }

  function receber(pedaco: Buffer): void {
    const { quadros, resto } = decodificar(Buffer.concat([acumulado, pedaco]))
    acumulado = resto
    for (const { op, dados } of quadros) {
      if (op === OP.ping) {
        socket?.write(codificar(OP.pong, dados))
        continue
      }
      if (op === OP.fechar) {
        // Em geral e Client ID invalido. Tentar de novo de 15 em 15 segundos e
        // barato, e conserta sozinho quando o ID certo chegar.
        console.warn('[altcast] o Discord fechou a conexao', dados)
        derrubar()
        agendarTentativa()
        return
      }
      const evento = (dados as { evt?: unknown } | null)?.evt
      if (evento === 'READY') {
        pronto = true
        enviar()
      } else if (evento === 'ERROR') {
        console.warn('[altcast] o Discord recusou a atividade', dados)
      }
    }
  }

  function enviar(): void {
    if (!pronto || socket === null || envioAdiado !== null) return
    const falta = ultimoEnvio + intervaloMinimoMs - Date.now()
    if (falta > 0) {
      envioAdiado = setTimeout(() => {
        envioAdiado = null
        enviar()
      }, falta)
      envioAdiado.unref()
      return
    }
    ultimoEnvio = Date.now()
    socket.write(codificar(OP.quadro, {
      cmd: 'SET_ACTIVITY',
      // Sem `activity` o Discord limpa o cartao. O `pid` amarra o cartao ao
      // processo: quando o Altcast morre, o Discord o apaga sozinho.
      args: desejada === null ? { pid } : { pid, activity: desejada.atividade },
      nonce: randomUUID(),
    }))
  }

  return {
    definir(atividade) {
      if (encerrado) return
      desejada = atividade
      if (atividade === null) {
        if (tentativa !== null) { clearTimeout(tentativa); tentativa = null }
        enviar()
        return
      }
      if (socket !== null && clientIdDoSocket !== atividade.clientId) derrubar()
      if (pronto) enviar()
      else void conectar()
    },

    encerrar() {
      encerrado = true
      if (tentativa !== null) clearTimeout(tentativa)
      if (envioAdiado !== null) clearTimeout(envioAdiado)
      tentativa = null
      envioAdiado = null
      derrubar()
    },
  }
}
