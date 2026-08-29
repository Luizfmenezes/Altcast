import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { conectarSocket, esperaDeReconexao, type SocketStatus } from '../src/lib/socket.js'

/** WebSocket falso: registra o que foi aberto e deixa o teste derrubar a conexao. */
class SocketFalso {
  static abertos: SocketFalso[] = []
  static ultimo(): SocketFalso {
    return SocketFalso.abertos[SocketFalso.abertos.length - 1]!
  }

  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = SocketFalso.CONNECTING
  enviados: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    SocketFalso.abertos.push(this)
  }

  abrir(): void {
    this.readyState = SocketFalso.OPEN
    this.onopen?.()
  }

  receber(quadro: unknown): void {
    this.onmessage?.({ data: JSON.stringify(quadro) })
  }

  cair(): void {
    this.readyState = SocketFalso.CLOSED
    this.onclose?.()
  }

  send(dados: string): void { this.enviados.push(dados) }
  close(): void { this.cair() }
}

describe('espera de reconexao', () => {
  it('cresce exponencialmente ate o teto de 30s', () => {
    const semJitter = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(esperaDeReconexao(1)).toBe(1000)
    expect(esperaDeReconexao(2)).toBe(2000)
    expect(esperaDeReconexao(3)).toBe(4000)
    expect(esperaDeReconexao(4)).toBe(8000)
    expect(esperaDeReconexao(9)).toBe(30_000)
    expect(esperaDeReconexao(50)).toBe(30_000)
    semJitter.mockRestore()
  })

  it('aplica jitter de ate 30% em cada espera', () => {
    const amostras = Array.from({ length: 100 }, () => esperaDeReconexao(1))

    // Sem jitter, o servidor reiniciando faz todos os clientes voltarem no
    // mesmo milissegundo e derrubarem de novo o que acabou de subir.
    expect(new Set(amostras).size).toBeGreaterThan(1)
    for (const espera of amostras) {
      expect(espera).toBeGreaterThanOrEqual(700)
      expect(espera).toBeLessThanOrEqual(1300)
    }
  })
})

describe('cliente WebSocket', () => {
  let estados: SocketStatus[]
  let eventos: { t: string; d: unknown }[]

  beforeEach(() => {
    vi.useFakeTimers()
    SocketFalso.abertos = []
    estados = []
    eventos = []
    vi.stubGlobal('WebSocket', SocketFalso)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function ligar(extras: Parameters<typeof conectarSocket>[0] = {}) {
    return conectarSocket({
      onEvent: e => eventos.push(e),
      onStatus: s => estados.push(s),
      ...extras,
    })
  }

  it('reporta status para a barra de conexao', async () => {
    const conexao = ligar()
    expect(estados).toContain('reconectando')

    SocketFalso.ultimo().abrir()
    expect(estados.at(-1)).toBe('conectado')

    SocketFalso.ultimo().cair()
    expect(estados.at(-1)).toBe('reconectando')
    conexao.fechar()
  })

  it('reconecta com backoff exponencial apos quedas sucessivas', async () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    expect(SocketFalso.abertos).toHaveLength(1)

    SocketFalso.ultimo().cair()
    await vi.advanceTimersByTimeAsync(1300)
    expect(SocketFalso.abertos).toHaveLength(2)

    // Segunda queda seguida: a espera dobra, entao 1300ms ainda nao basta.
    SocketFalso.ultimo().cair()
    await vi.advanceTimersByTimeAsync(600)
    expect(SocketFalso.abertos).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(SocketFalso.abertos).toHaveLength(3)

    conexao.fechar()
  })

  it('zera o contador apos 60s de conexao estavel', async () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    SocketFalso.ultimo().cair()
    await vi.advanceTimersByTimeAsync(1300)

    // Conexao que durou um minuto nao e conexao instavel: a proxima queda
    // volta a esperar ~1s, e nao a espera acumulada.
    SocketFalso.ultimo().abrir()
    await vi.advanceTimersByTimeAsync(60_000)
    SocketFalso.ultimo().cair()

    const antes = SocketFalso.abertos.length
    await vi.advanceTimersByTimeAsync(1300)
    expect(SocketFalso.abertos.length).toBe(antes + 1)

    conexao.fechar()
  })

  it('responde ao ping do servidor com pong', () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    SocketFalso.ultimo().receber({ t: 'ping', d: {} })

    expect(SocketFalso.ultimo().enviados).toContain(JSON.stringify({ t: 'pong' }))
    conexao.fechar()
  })

  it('entrega os eventos do servidor a quem escuta', () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    SocketFalso.ultimo().receber({ t: 'message.created', d: { id: 'm1' } })

    expect(eventos).toEqual([{ t: 'message.created', d: { id: 'm1' } }])
    conexao.fechar()
  })

  it('ao reconectar, busca por REST o que perdeu em cada canal aberto', async () => {
    const conexao = ligar({
      canaisAbertos: () => ({ c1: 'M50', c2: null }),
    })
    SocketFalso.ultimo().abrir()

    // A primeira conexao nao reconcilia: nao havia buraco antes dela.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()

    SocketFalso.ultimo().cair()
    await vi.advanceTimersByTimeAsync(1300)
    SocketFalso.ultimo().abrir()
    await vi.advanceTimersByTimeAsync(0)

    const urls = vi.mocked(fetch).mock.calls.map(c => String(c[0]))
    expect(urls).toContain('/api/channels/c1/messages?after=M50')
    // Canal sem historico carregado nao tem buraco a curar.
    expect(urls.some(u => u.includes('c2'))).toBe(false)

    conexao.fechar()
  })

  it('reconecta imediatamente quando a aba volta a ficar visivel', async () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    SocketFalso.ultimo().cair()

    const antes = SocketFalso.abertos.length
    // Sem esperar o backoff: quem voltou para a aba quer a conversa agora.
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(SocketFalso.abertos.length).toBe(antes + 1)

    conexao.fechar()
  })

  it('fechar encerra de vez e nao reconecta mais', async () => {
    const conexao = ligar()
    SocketFalso.ultimo().abrir()
    conexao.fechar()

    const antes = SocketFalso.abertos.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(SocketFalso.abertos.length).toBe(antes)
    expect(estados.at(-1)).toBe('offline')
  })
})
