/**
 * A geometria da janela, sem Electron nenhum por perto.
 *
 * Separada de `estadoDaJanela.ts` para poder ser exercitada sem subir um
 * processo grafico — e ela e justamente o pedaco com consequencia: e esta
 * conta que separa "a janela abriu num lugar estranho" de "a janela abriu
 * invisivel, com o audio tocando e sem jeito de ser trazida de volta".
 */

export type Retangulo = { x: number; y: number; width: number; height: number }

/** Quanto da janela precisa cair dentro de algum monitor para a posicao valer. */
export const VISIVEL_MINIMO = { largura: 80, altura: 60 }

/**
 * Alguma parte util da janela cai dentro de algum monitor?
 *
 * Exige INTERSECAO, e nao contencao. Quem sempre deixa a janela encostada na
 * borda — meia janela para fora, de proposito — tem uma posicao legitima que a
 * contencao jogaria fora a cada abertura.
 */
export function dentroDeAlgumMonitor(
  janela: { x?: number; y?: number; width: number; height: number },
  monitores: Retangulo[],
): boolean {
  // Sem posicao guardada nao ha o que validar: o sistema centraliza.
  if (janela.x === undefined || janela.y === undefined) return true
  if (monitores.length === 0) return false

  const x = janela.x
  const y = janela.y

  return monitores.some(m => {
    const largura = Math.min(x + janela.width, m.x + m.width) - Math.max(x, m.x)
    const altura = Math.min(y + janela.height, m.y + m.height) - Math.max(y, m.y)
    return largura >= VISIVEL_MINIMO.largura && altura >= VISIVEL_MINIMO.altura
  })
}
