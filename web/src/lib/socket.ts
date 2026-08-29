import { api } from './api.js'

/**
 * Cliente WebSocket.
 *
 * Aqui "o WebSocket tem permissao para perder eventos" vira codigo. Nao existe
 * numero de sequencia, buffer de replay nem confirmacao de recebimento — tudo
 * isso reconstruiria TCP mal feito em cima de TCP. Ao reconectar, o cliente
 * pergunta ao REST o que aconteceu depois da ultima mensagem que ele conhece,
 * e o buraco se cura sozinho. A verdade mora sempre no REST.
 */
export type SocketStatus = 'conectado' | 'reconectando' | 'offline'

export type ServerEvent = { t: string; d: unknown }

/**
 * Mapa de canal para o ID da ultima mensagem conhecida. `null` significa canal
 * sem historico carregado — e canal sem historico nao tem buraco a curar.
 */
export type CanaisAbertos = Record<string, string | null>

export type OpcoesSocket = {
  onEvent?: (evento: ServerEvent) => void
  onStatus?: (status: SocketStatus) => void
  /** Lido a cada reconexao, e nao capturado uma vez: os canais abertos mudam. */
  canaisAbertos?: () => CanaisAbertos
  url?: string
}

const TETO_ESPERA_MS = 30_000
const ESTAVEL_APOS_MS = 60_000
const JITTER = 0.3

/**
 * Espera antes da proxima tentativa: 1s, 2s, 4s, 8s, com teto de 30s, sempre
 * com ate 30% de variacao para cima ou para baixo.
 *
 * O jitter parece pedante e nao e: sem ele, o servidor reiniciando faz todos os
 * clientes voltarem no mesmo milissegundo e derrubarem de novo o que acabou de
 * subir.
 */
export function esperaDeReconexao(tentativa: number): number {
  const base = Math.min(1000 * 2 ** (tentativa - 1), TETO_ESPERA_MS)
  const variacao = base * JITTER * (Math.random() * 2 - 1)
  return Math.round(base + variacao)
}

function urlPadrao(): string {
  const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocolo}//${window.location.host}/ws`
}

export type QuadroCliente = { t: string; d?: unknown }

export type Conexao = {
  fechar: () => void
  reconectarAgora: () => void
  /**
   * Manda um quadro ao servidor. Devolve `false` quando nao havia socket
   * aberto — e a chamada NAO fica em fila.
   *
   * Enfileirar seria reconstruir a entrega garantida que a spec 04 recusa de
   * proposito: um `voice.state` represado por dez segundos chegaria mentindo
   * sobre o microfone. Quem se importa com o estado o reanuncia ao reconectar,
   * que e o mesmo caminho que ja cura o buraco das mensagens.
   */
  enviar: (quadro: QuadroCliente) => boolean
}

export function conectarSocket(opcoes: OpcoesSocket = {}): Conexao {
  const { onEvent, onStatus, canaisAbertos } = opcoes
  const url = opcoes.url ?? urlPadrao()

  let socket: WebSocket | null = null
  let tentativa = 0
  let abertoEm = 0
  let agendado: ReturnType<typeof setTimeout> | null = null
  let encerrado = false
  /** A primeira conexao nao reconcilia: nao havia buraco antes dela. */
  let jaConectouUmaVez = false

  const anunciar = (s: SocketStatus): void => onStatus?.(s)

  /**
   * Para cada canal com historico carregado, pergunta o que chegou depois do
   * ultimo ID conhecido. Falha aqui e silenciosa de proposito: a proxima
   * abertura de canal recarrega o historico de qualquer forma, e derrubar a
   * reconexao por causa da reconciliacao seria trocar um buraco por uma queda.
   */
  async function reconciliar(): Promise<void> {
    const abertos = canaisAbertos?.() ?? {}
    await Promise.all(Object.entries(abertos).map(async ([canal, ultimo]) => {
      if (ultimo === null) return
      try {
        const novas = await api.get<ServerEvent['d'][]>(
          `/channels/${canal}/messages?after=${ultimo}`,
        )
        for (const mensagem of novas as unknown[]) {
          onEvent?.({ t: 'message.created', d: mensagem })
        }
      } catch {
        // Sem rede a reconexao nem teria acontecido; qualquer outra falha se
        // resolve no proximo carregamento do canal.
      }
    }))
  }

  function agendarReconexao(): void {
    if (encerrado || agendado !== null) return
    tentativa += 1
    agendado = setTimeout(() => {
      agendado = null
      abrir()
    }, esperaDeReconexao(tentativa))
  }

  function abrir(): void {
    if (encerrado) return
    anunciar('reconectando')

    const ws = new WebSocket(url)
    socket = ws

    ws.onopen = () => {
      abertoEm = Date.now()
      anunciar('conectado')
      if (jaConectouUmaVez) void reconciliar()
      jaConectouUmaVez = true
    }

    ws.onmessage = evento => {
      let quadro: ServerEvent
      try {
        quadro = JSON.parse(String((evento as { data: unknown }).data)) as ServerEvent
      } catch {
        return
      }
      // O servidor tambem usa ping de protocolo; este e o de aplicacao, para
      // navegadores que nao expoem o frame nativo ao JavaScript.
      if (quadro.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
      onEvent?.(quadro)
    }

    const caiu = (): void => {
      if (socket !== ws) return
      socket = null
      if (encerrado) return
      // Conexao que durou um minuto nao e conexao instavel: a proxima queda
      // recomeca a contagem em vez de herdar a espera acumulada.
      if (abertoEm !== 0 && Date.now() - abertoEm >= ESTAVEL_APOS_MS) tentativa = 0
      abertoEm = 0
      anunciar('reconectando')
      agendarReconexao()
    }

    ws.onclose = caiu
    ws.onerror = caiu
  }

  function reconectarAgora(): void {
    if (encerrado || socket !== null) return
    if (agendado !== null) {
      clearTimeout(agendado)
      agendado = null
    }
    abrir()
  }

  // Quem voltou para a aba, ou cuja rede voltou, quer a conversa agora — e nao
  // no fim de uma espera de trinta segundos que comecou enquanto ninguem olhava.
  const aoVoltar = (): void => {
    if (document.visibilityState !== 'hidden') reconectarAgora()
  }
  document.addEventListener('visibilitychange', aoVoltar)
  window.addEventListener('online', reconectarAgora)

  abrir()

  return {
    enviar: quadro => {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(quadro))
      return true
    },

    fechar: () => {
      encerrado = true
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('online', reconectarAgora)
      if (agendado !== null) clearTimeout(agendado)
      agendado = null
      const atual = socket
      socket = null
      atual?.close()
      anunciar('offline')
    },
    reconectarAgora,
  }
}
