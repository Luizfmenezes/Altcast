import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { criarAtualizador } from '../src/atualizador'
import type { EstadoDaAtualizacao } from '../src/ponte'

/** O `autoUpdater` do electron-updater, reduzido ao que o atualizador usa. */
class UpdaterFalso extends EventEmitter {
  procuras = 0
  falhar = false
  async checkForUpdates(): Promise<unknown> {
    this.procuras += 1
    if (this.falhar) throw new Error('sem rede')
    return null
  }
}

function montar(opcoes = {}): { u: UpdaterFalso; estados: EstadoDaAtualizacao[]; a: ReturnType<typeof criarAtualizador> } {
  const u = new UpdaterFalso()
  const estados: EstadoDaAtualizacao[] = []
  const a = criarAtualizador(u, e => { estados.push(e) }, opcoes)
  return { u, estados, a }
}

afterEach(() => { vi.useRealTimers() })

describe('a atualizacao automatica', () => {
  it('do achado ao baixado: baixando com progresso, depois pronta', () => {
    const { u, a } = montar()
    u.emit('checking-for-update')
    expect(a.estado()).toEqual({ fase: 'procurando' })
    u.emit('update-available', { version: '0.3.1' })
    u.emit('download-progress', { percent: 41.7 })
    expect(a.estado()).toEqual({ fase: 'baixando', versao: '0.3.1', progresso: 42 })
    u.emit('update-downloaded', { version: '0.3.1' })
    expect(a.estado()).toEqual({ fase: 'pronta', versao: '0.3.1' })
  })

  it('em dia quando nao ha versao nova', () => {
    const { u, a } = montar()
    u.emit('checking-for-update')
    u.emit('update-not-available', { version: '0.3.0' })
    expect(a.estado()).toEqual({ fase: 'em-dia' })
  })

  /** A versao baixada e instalada ao fechar; nada que venha depois a apaga da tela. */
  it('pronta continua pronta numa procura seguinte, mesmo com erro', () => {
    const { u, a } = montar()
    u.emit('update-downloaded', { version: '0.3.1' })
    u.emit('checking-for-update')
    u.emit('error', new Error('sem rede'))
    u.emit('update-not-available', {})
    expect(a.estado()).toEqual({ fase: 'pronta', versao: '0.3.1' })
  })

  it('erro de rede vira estado, e nao excecao', async () => {
    const { u, a } = montar()
    u.falhar = true
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await a.procurar()
    u.emit('error', new Error('sem rede'))
    expect(a.estado()).toEqual({ fase: 'erro' })
    aviso.mockRestore()
  })

  it('progresso so avisa quando o ponto percentual muda', () => {
    const { u, estados } = montar()
    u.emit('update-available', { version: '0.3.1' })
    u.emit('download-progress', { percent: 10.1 })
    u.emit('download-progress', { percent: 10.2 })
    u.emit('download-progress', { percent: 10.4 })
    expect(estados.filter(e => e.fase === 'baixando')).toHaveLength(2) // 0% e 10%
  })

  it('nao procura de novo enquanto baixa', async () => {
    const { u, a } = montar()
    u.emit('update-available', { version: '0.3.1' })
    await a.procurar()
    expect(u.procuras).toBe(0)
  })

  it('procura depois da espera inicial e de novo a cada intervalo', () => {
    vi.useFakeTimers()
    const { u, a } = montar({ esperaInicialMs: 1_000, intervaloMs: 60_000 })
    a.iniciar()
    vi.advanceTimersByTime(999)
    expect(u.procuras).toBe(0)
    vi.advanceTimersByTime(1)
    expect(u.procuras).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(u.procuras).toBe(2)
    a.parar()
    vi.advanceTimersByTime(600_000)
    expect(u.procuras).toBe(2)
  })
})
