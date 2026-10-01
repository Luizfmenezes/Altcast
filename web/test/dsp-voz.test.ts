import { describe, it, expect } from 'vitest'
import { Alinhador, BLOCO, misturar, nivelDb, Portao } from '../src/lib/dsp/voz.js'

/**
 * O tratamento da voz depois da rede, com sinal sintetico.
 *
 * O worklet em si precisa de navegador; as contas que ele faz, nao. Cada bloco
 * aqui e o que a thread de audio entregaria: 128 amostras a 48 kHz.
 */

/** Ruido deterministico: o teste nao pode depender da sorte do Math.random. */
function gerador(semente = 1): () => number {
  let s = semente
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

/** Um bloco de ruido com o nivel RMS pedido, em dBFS. */
function blocoEm(db: number, aleatorio = gerador()): Float32Array {
  // Ruido uniforme em [-1, 1] tem RMS 1/sqrt(3).
  const escala = 10 ** (db / 20) * Math.sqrt(3)
  return Float32Array.from({ length: BLOCO }, () => aleatorio() * escala)
}

const energia = (b: Float32Array): number => b.reduce((s, v) => s + v * v, 0)

/** Blocos por segundo a 48 kHz. */
const POR_SEGUNDO = Math.round(48_000 / BLOCO)

describe('nivelDb', () => {
  it('silencio digital e o piso, e nao -Infinity', () => {
    expect(nivelDb(new Float32Array(BLOCO))).toBe(-100)
  })

  it('mede o nivel RMS em dBFS', () => {
    expect(nivelDb(blocoEm(-20))).toBeCloseTo(-20, 0)
    expect(nivelDb(blocoEm(-45))).toBeCloseTo(-45, 0)
  })
})

describe('o portao (sensibilidade de entrada)', () => {
  it('desligado, deixa tudo passar como chegou', () => {
    const portao = new Portao({ modo: 'desligado', limiarDb: -50 })
    const bloco = blocoEm(-70)
    const antes = Float32Array.from(bloco)
    for (let i = 0; i < POR_SEGUNDO; i++) portao.processar(Float32Array.from(antes))
    portao.processar(bloco)
    expect(bloco).toEqual(antes)
  })

  it('automatico: aprende o ambiente, fecha nele, e abre na primeira silaba', () => {
    const portao = new Portao({ modo: 'automatico', limiarDb: -50 })
    const aleatorio = gerador(7)
    // Dois segundos de ventilador a -60 dB: o piso desce ate ele.
    for (let i = 0; i < 2 * POR_SEGUNDO; i++) portao.processar(blocoEm(-60, aleatorio))
    expect(portao.estaAberto()).toBe(false)
    expect(portao.limiarDb()).toBeGreaterThan(-60)

    const ambiente = blocoEm(-60, aleatorio)
    portao.processar(ambiente)
    expect(energia(ambiente)).toBeLessThan(1e-9)

    // A voz a -25 dB abre no MESMO bloco: a primeira silaba nao pode sumir.
    const voz = blocoEm(-25, aleatorio)
    const original = energia(voz)
    portao.processar(voz)
    expect(portao.estaAberto()).toBe(true)
    expect(energia(voz)).toBeGreaterThan(original * 0.5)
  })

  it('segura o fim da frase antes de fechar', () => {
    const portao = new Portao({ modo: 'manual', limiarDb: -40 }, 48_000, { seguraMs: 280 })
    const aleatorio = gerador(3)
    for (let i = 0; i < 20; i++) portao.processar(blocoEm(-20, aleatorio))
    expect(portao.estaAberto()).toBe(true)

    // 200 ms de silencio: ainda dentro da segura.
    for (let i = 0; i < Math.round(0.2 * POR_SEGUNDO); i++) portao.processar(blocoEm(-80, aleatorio))
    expect(portao.estaAberto()).toBe(true)
    // Mais 200 ms: passou dos 280 ms, fecha.
    for (let i = 0; i < Math.round(0.2 * POR_SEGUNDO); i++) portao.processar(blocoEm(-80, aleatorio))
    expect(portao.estaAberto()).toBe(false)
  })

  it('manual: o limiar e o escolhido, e nao o do ambiente', () => {
    const portao = new Portao({ modo: 'manual', limiarDb: -30 })
    expect(portao.limiarDb()).toBe(-30)
    const aleatorio = gerador(5)
    for (let i = 0; i < POR_SEGUNDO; i++) portao.processar(blocoEm(-40, aleatorio))
    expect(portao.estaAberto()).toBe(false)
    portao.ajustar({ modo: 'manual', limiarDb: -50 })
    portao.processar(blocoEm(-40, aleatorio))
    expect(portao.estaAberto()).toBe(true)
  })

  it('o limiar automatico nunca exige grito, nem abre com respiracao', () => {
    const barulhento = new Portao({ modo: 'automatico', limiarDb: -50 })
    for (let i = 0; i < 2 * POR_SEGUNDO; i++) barulhento.processar(blocoEm(-15))
    expect(barulhento.limiarDb()).toBeLessThanOrEqual(-30)

    const silencioso = new Portao({ modo: 'automatico', limiarDb: -50 })
    for (let i = 0; i < 2 * POR_SEGUNDO; i++) silencioso.processar(new Float32Array(BLOCO))
    expect(silencioso.limiarDb()).toBeGreaterThanOrEqual(-70)
  })
})

describe('o alinhador (para a intensidade)', () => {
  it('acha o atraso que a rede introduz', () => {
    const ATRASO = 777
    const alinhador = new Alinhador(1024, 256, 40)
    const aleatorio = gerador(11)
    const historico: number[] = Array.from({ length: ATRASO }, () => 0)
    for (let b = 0; b < 400 && alinhador.atraso() === null; b++) {
      const seco = Float32Array.from({ length: BLOCO }, () => aleatorio() * 0.3)
      historico.push(...seco)
      // A "rede": devolve o original atrasado, um pouco mais baixo.
      const inicio = historico.length - BLOCO - ATRASO
      const limpo = Float32Array.from(historico.slice(inicio, inicio + BLOCO), v => v * 0.8)
      alinhador.empurrar(seco, limpo, true)
    }
    expect(alinhador.atraso()).toBe(ATRASO)
  })

  it('sem voz nao decide nada', () => {
    const alinhador = new Alinhador(512, 128, 10)
    const aleatorio = gerador(13)
    for (let b = 0; b < 200; b++) {
      const seco = blocoEm(-30, aleatorio)
      alinhador.empurrar(seco, seco, false)
    }
    expect(alinhador.atraso()).toBeNull()
  })

  it('le o original atrasado de volta, amostra por amostra', () => {
    const alinhador = new Alinhador(256, 128, 10)
    const seco1 = Float32Array.from({ length: BLOCO }, (_, i) => i)
    const seco2 = Float32Array.from({ length: BLOCO }, (_, i) => 1000 + i)
    alinhador.empurrar(seco1, seco1, false)
    alinhador.empurrar(seco2, seco2, false)
    const destino = new Float32Array(BLOCO)
    alinhador.lerAtrasado(destino, 10)
    // A amostra 0 do bloco atual, 10 atras, e a amostra 118 do anterior.
    expect(destino[0]).toBe(118)
    expect(destino[10]).toBe(1000)
  })
})

describe('a mistura da intensidade', () => {
  it('a 100% nao toca em nada', () => {
    const limpo = Float32Array.from([0.5, -0.5])
    misturar(limpo, Float32Array.from([1, 1]), 1)
    expect([...limpo]).toEqual([0.5, -0.5])
  })

  it('a 60% devolve 40% do original', () => {
    const limpo = Float32Array.from([1, 0])
    misturar(limpo, Float32Array.from([0, 1]), 0.6)
    expect(limpo[0]).toBeCloseTo(0.6)
    expect(limpo[1]).toBeCloseTo(0.4)
  })
})
