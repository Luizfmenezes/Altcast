import { describe, it, expect } from 'vitest'
import { dentroDeAlgumMonitor } from '../src/geometriaDaJanela'

/**
 * A conta que impede a janela invisivel.
 *
 * Restaurar a janela em `x: 3000` depois de o segundo monitor ter sido
 * desconectado nao produz uma janela "fora do lugar": produz uma janela que
 * existe, tem foco, recebe audio e NAO APARECE — e cujo unico conserto e
 * apagar um arquivo em AppData que a pessoa nao sabe que existe.
 */

const PRINCIPAL = { x: 0, y: 0, width: 1920, height: 1040 }
const SEGUNDO = { x: 1920, y: 0, width: 1920, height: 1040 }

describe('a janela cabe em algum monitor?', () => {
  it('janela inteira dentro do monitor principal', () => {
    expect(dentroDeAlgumMonitor(
      { x: 100, y: 100, width: 1280, height: 800 }, [PRINCIPAL],
    )).toBe(true)
  })

  it('sem posicao guardada, nao ha o que validar', () => {
    // O sistema centraliza sozinho, e centralizado e sempre visivel.
    expect(dentroDeAlgumMonitor({ width: 1280, height: 800 }, [])).toBe(true)
  })

  /**
   * O caso que motiva tudo: a janela estava no segundo monitor, e o segundo
   * monitor foi embora.
   */
  it('monitor desconectado invalida a posicao', () => {
    const noSegundo = { x: 2200, y: 200, width: 1280, height: 800 }
    expect(dentroDeAlgumMonitor(noSegundo, [PRINCIPAL, SEGUNDO])).toBe(true)
    expect(dentroDeAlgumMonitor(noSegundo, [PRINCIPAL])).toBe(false)
  })

  /**
   * Intersecao, e nao contencao.
   *
   * Quem sempre deixa a janela encostada na borda — meia janela para fora, de
   * proposito — tem uma posicao legitima. Exigir que ela caiba inteira jogaria
   * essa escolha fora a cada abertura.
   */
  it('janela encostada na borda continua valendo', () => {
    expect(dentroDeAlgumMonitor(
      { x: 1600, y: 100, width: 1280, height: 800 }, [PRINCIPAL],
    )).toBe(true)
  })

  it('so uma frestinha visivel nao basta', () => {
    // 20px de largura visivel: nao da para agarrar a barra de titulo.
    expect(dentroDeAlgumMonitor(
      { x: 1900, y: 100, width: 1280, height: 800 }, [PRINCIPAL],
    )).toBe(false)
  })

  it('posicao negativa de um monitor a esquerda e valida', () => {
    const esquerda = { x: -1920, y: 0, width: 1920, height: 1040 }
    expect(dentroDeAlgumMonitor(
      { x: -1800, y: 100, width: 1280, height: 800 }, [esquerda, PRINCIPAL],
    )).toBe(true)
  })

  it('sem monitor nenhum, nenhuma posicao vale', () => {
    expect(dentroDeAlgumMonitor(
      { x: 100, y: 100, width: 1280, height: 800 }, [],
    )).toBe(false)
  })

  it('janela abaixo da borda inferior e recusada', () => {
    expect(dentroDeAlgumMonitor(
      { x: 100, y: 1020, width: 1280, height: 800 }, [PRINCIPAL],
    )).toBe(false)
  })
})
