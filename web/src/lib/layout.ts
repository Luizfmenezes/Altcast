/**
 * As larguras das colunas, escolhidas pela pessoa e lembradas entre visitas.
 *
 * Guardado em PIXELS, e nao em porcentagem — apesar de a biblioteca de paineis
 * trabalhar em porcentagem. A razao e o significado: a spec 05 fixa a lista de
 * canais em 240px porque 240px e a largura em que um nome de canal cabe, e
 * isso nao depende do tamanho do monitor. Um layout salvo como "15%" num
 * monitor de 2560px volta como 192px num laptop de 1280px, e a pessoa acha que
 * o sistema esqueceu. Salvo como 240px, volta 240px em qualquer tela.
 *
 * A conversao para porcentagem acontece uma vez, na montagem, contra a largura
 * medida do container.
 */

export type LayoutDoShell = {
  canaisPx: number
  membrosPx: number
  canaisRecolhido: boolean
  membrosRecolhido: boolean
}

/** Os mesmos numeros de `--w-channels` e `--w-members` em tokens.css. */
export const LAYOUT_PADRAO: LayoutDoShell = {
  canaisPx: 240,
  membrosPx: 240,
  canaisRecolhido: false,
  membrosRecolhido: false,
}

export const CANAIS_MIN = 180
export const CANAIS_MAX = 420
export const MEMBROS_MIN = 180
export const MEMBROS_MAX = 360
/**
 * A conversa nunca encolhe abaixo disto. E o mesmo numero de
 * `LARGURA_CHAT_NA_CHAMADA`: abaixo dele a lista de mensagens deixa de ser
 * legivel e o campo de escrita vira uma fresta.
 */
export const CONVERSA_MIN = 320

const CHAVE = 'altcast:layout'

/**
 * Largura de referencia para quando ainda nao ha medida — o jsdom, e o
 * primeiro quadro antes do `useLayoutEffect`. Escolhido para bater com o
 * layout completo de quatro colunas da spec.
 */
const LARGURA_DE_REFERENCIA = 1200

function limitar(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min
  return Math.min(Math.max(valor, min), max)
}

/**
 * O que foi guardado, ou o padrao.
 *
 * Nunca lanca, e nunca devolve um numero absurdo: um `localStorage` corrompido
 * — ou editado a mao — nao pode produzir uma coluna de 4000px que empurra a
 * conversa para fora da tela e nao tem como ser consertada pela interface.
 */
export function lerLayout(): LayoutDoShell {
  try {
    const bruto = window.localStorage.getItem(CHAVE)
    if (bruto === null) return LAYOUT_PADRAO
    const lido = JSON.parse(bruto) as Partial<LayoutDoShell>
    return {
      canaisPx: limitar(Number(lido.canaisPx ?? LAYOUT_PADRAO.canaisPx), CANAIS_MIN, CANAIS_MAX),
      membrosPx: limitar(Number(lido.membrosPx ?? LAYOUT_PADRAO.membrosPx), MEMBROS_MIN, MEMBROS_MAX),
      canaisRecolhido: lido.canaisRecolhido === true,
      membrosRecolhido: lido.membrosRecolhido === true,
    }
  } catch {
    // Navegacao privada recusa ate a leitura, e JSON quebrado lanca. Nos dois
    // casos o padrao e a resposta certa — mesma politica do ThemeProvider.
    return LAYOUT_PADRAO
  }
}

export function guardarLayout(layout: LayoutDoShell): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(layout))
  } catch {
    // Escrever e um agrado, nao um requisito: a sessao continua funcionando
    // com o layout so na memoria.
  }
}

/**
 * Pixels para porcentagem do grupo de paineis.
 *
 * `largura` zero acontece no jsdom e no primeiro quadro, antes de o
 * `ResizeObserver` medir. Cair numa largura de referencia — em vez de dividir
 * por zero — e o que faz o layout nascer coerente em vez de colapsado.
 */
export function pctDe(px: number, largura: number): number {
  const base = largura > 0 ? largura : LARGURA_DE_REFERENCIA
  return limitar((px / base) * 100, 1, 90)
}

/** O caminho de volta: o que a biblioteca reporta vira pixel para guardar. */
export function pxDe(pct: number, largura: number): number {
  const base = largura > 0 ? largura : LARGURA_DE_REFERENCIA
  return Math.round((pct / 100) * base)
}
