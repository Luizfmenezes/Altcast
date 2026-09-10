/**
 * A ponte para o app de desktop — e a regra que impede o produto de bifurcar.
 *
 * O Altcast roda em dois lugares: no navegador, como sempre, e dentro de uma
 * janela do Electron que carrega esta MESMA interface pela URL do servidor.
 * Nada aqui e condicional a um build: e o mesmo pacote, servido uma vez, e a
 * unica diferenca e se `window.altcast` existe ou nao.
 *
 * Por isso todo recurso de desktop se le da mesma forma: "existe a ponte?
 * entao isto; senao, o caminho de sempre". Um `if` por capacidade, nunca um
 * `if` por plataforma — a segunda forma e a que, em tres meses, produz uma
 * tela que so funciona num dos dois.
 *
 * A forma dos tipos abaixo espelha `desktop/src/ponte.ts`. Sao dois
 * workspaces sem pacote comum; o teste que roda a interface com uma ponte
 * falsa e o que faz uma divergencia aparecer em vez de silenciar.
 */

/** Uma tela ou uma janela que pode ser transmitida. */
export type FonteDeTela = {
  id: string
  nome: string
  tipo: 'tela' | 'janela'
  /** PNG em data URL. */
  miniatura: string
  icone: string | null
}

/**
 * Se o som do sistema entra na transmissao.
 *
 * `sistema` e o motivo de o app existir: no navegador, compartilhar uma JANELA
 * nunca leva audio — o Chrome so oferece a caixa "compartilhar audio" para aba
 * e para tela inteira. No app o som vem junto em qualquer caso.
 */
export type SomDaTela = 'sistema' | 'nenhum'

export type PonteNativa = {
  versao: string
  listarFontes: () => Promise<FonteDeTela[]>
  escolherFonte: (id: string, som: SomDaTela) => Promise<void>
}

/**
 * A ponte injetada para teste.
 *
 * `undefined` quer dizer "ninguem injetou, olhe a janela"; `null` quer dizer
 * "injetaram a ausencia", que e como um teste reproduz o navegador comum
 * mesmo rodando num ambiente onde alguem mexeu no global. A distincao entre
 * os dois e o que permite `naoNativoParaTeste()` existir.
 */
let injetada: PonteNativa | null | undefined

/**
 * A ponte, ou `null` no navegador.
 *
 * Chamada a cada uso em vez de guardada num modulo: a alternativa — ler
 * `window.altcast` uma vez no carregamento — congela a resposta antes de o
 * `preload` terminar de expor, e o sintoma seria um app que se comporta como
 * navegador apenas no primeiro segundo.
 */
export function nativo(): PonteNativa | null {
  if (injetada !== undefined) return injetada
  if (typeof window === 'undefined') return null
  const w = window as unknown as { altcast?: PonteNativa }
  const ponte = w.altcast
  // A checagem e por CAPACIDADE, e nao pela existencia do objeto: uma versao
  // antiga do app instalada contra uma interface nova exporia uma ponte sem os
  // metodos que a interface passou a usar, e chamar o que nao existe daria um
  // TypeError no meio de um clique. Faltando um metodo, a interface trata como
  // navegador e usa o caminho que sempre funcionou.
  if (ponte === undefined) return null
  if (typeof ponte.listarFontes !== 'function') return null
  if (typeof ponte.escolherFonte !== 'function') return null
  return ponte
}

/** Roda dentro do app de desktop? */
export function ehDesktop(): boolean {
  return nativo() !== null
}

/** Injeta uma ponte falsa. Somente teste. */
export function definirNativoParaTeste(ponte: PonteNativa): void {
  injetada = ponte
}

/** Forca o caminho do navegador. Somente teste. */
export function naoNativoParaTeste(): void {
  injetada = null
}

/** Devolve a deteccao ao normal. Somente teste. */
export function esquecerNativoParaTeste(): void {
  injetada = undefined
}
