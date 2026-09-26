/**
 * Os sons da chamada.
 *
 * Sintetizados, e nao tocados de arquivo. Tres razoes, em ordem de peso:
 *
 * 1. A CSP do Caddy e `default-src 'self'` com `media-src 'self' blob:`.
 *    Arquivo proprio seria legal, mas som gerado na pagina nao depende de
 *    permissao nenhuma — nao ha como uma politica futura quebra-lo.
 * 2. Sete arquivos a ~8 KB sao ~56 KB de binario e sete requisicoes, contra
 *    duas paginas de codigo dentro de um pacote que ja esta em cache. O
 *    `public/` deste projeto so tem fontes e favicons, e continua assim.
 * 3. Afinar e mudar um numero. Trocar a paleta sonora inteira nao exige
 *    ninguem produzir audio.
 *
 * As deixas do Discord sao, elas proprias, dois tons curtos — um par de
 * osciladores com envelope e indistinguivel delas no contexto de uma chamada.
 *
 * Se um dia entrarem arquivos, o unico ponto a trocar e `tocarAgora`. A API
 * publica e os pontos de chamada nao mudam.
 */

export type Cue =
  | 'entrei' | 'sai'
  | 'mudo' | 'desmudo'
  | 'tela-ligou' | 'tela-desligou'
  | 'alguem-entrou' | 'alguem-saiu'

/**
 * Quem de fato emite o som.
 *
 * Injetavel pela MESMA razao que `SalaDeMidia` em midia.ts: o que precisa ser
 * provado e QUANDO o som sai — nunca como ele soa —, e um teste nao pode
 * depender de um `AudioContext` de verdade.
 */
export type Tocador = { tocar: (cue: Cue) => void }

export type PreferenciaDeSons = { ligado: boolean; volume: number }

export const PREFERENCIA_PADRAO: PreferenciaDeSons = { ligado: true, volume: 0.5 }

const CHAVE = 'altcast:sons'

/** Duas notas por deixa: inicio em segundos a partir de agora, e duracao. */
type Nota = { hz: number; inicio: number; duracao: number }

/**
 * A gramatica: sobe para entrar, desce para sair, seco para mutar.
 *
 * Nao e decoracao — e o que permite reconhecer o que aconteceu sem olhar para
 * a tela, que e a unica coisa que uma deixa sonora tem a oferecer.
 */
const CUES: Record<Cue, { notas: Nota[]; ganho: number }> = {
  entrei: { ganho: 0.22, notas: [
    { hz: 587.33, inicio: 0, duracao: 0.09 },
    { hz: 880.00, inicio: 0.07, duracao: 0.13 },
  ] },
  sai: { ganho: 0.22, notas: [
    { hz: 880.00, inicio: 0, duracao: 0.09 },
    { hz: 587.33, inicio: 0.07, duracao: 0.13 },
  ] },
  mudo: { ganho: 0.16, notas: [{ hz: 440.00, inicio: 0, duracao: 0.07 }] },
  desmudo: { ganho: 0.16, notas: [{ hz: 659.25, inicio: 0, duracao: 0.07 }] },
  'tela-ligou': { ganho: 0.18, notas: [
    { hz: 523.25, inicio: 0, duracao: 0.07 },
    { hz: 698.46, inicio: 0.06, duracao: 0.07 },
    { hz: 880.00, inicio: 0.12, duracao: 0.10 },
  ] },
  'tela-desligou': { ganho: 0.18, notas: [
    { hz: 880.00, inicio: 0, duracao: 0.07 },
    { hz: 698.46, inicio: 0.06, duracao: 0.07 },
    { hz: 523.25, inicio: 0.12, duracao: 0.10 },
  ] },
  // Mais baixas que as minhas: a chegada de outra pessoa e informacao de
  // fundo, e no volume das minhas proprias acoes viraria interrupcao.
  'alguem-entrou': { ganho: 0.12, notas: [
    { hz: 523.25, inicio: 0, duracao: 0.07 },
    { hz: 783.99, inicio: 0.06, duracao: 0.11 },
  ] },
  'alguem-saiu': { ganho: 0.12, notas: [
    { hz: 783.99, inicio: 0, duracao: 0.07 },
    { hz: 523.25, inicio: 0.06, duracao: 0.11 },
  ] },
}

/** Duas deixas iguais em menos disto viram uma. A tecla `M` repete. */
const INTERVALO_MINIMO_MS = 120

let contexto: AudioContext | null = null
let mestre: GainNode | null = null
let injetado: Tocador | null = null
const ultimaVez = new Map<Cue, number>()

export function lerPreferenciaDeSons(): PreferenciaDeSons {
  try {
    const bruto = window.localStorage.getItem(CHAVE)
    if (bruto === null) return PREFERENCIA_PADRAO
    const lido = JSON.parse(bruto) as Partial<PreferenciaDeSons>
    const volume = Number(lido.volume)
    return {
      ligado: lido.ligado !== false,
      volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : PREFERENCIA_PADRAO.volume,
    }
  } catch {
    return PREFERENCIA_PADRAO
  }
}

export function guardarPreferenciaDeSons(p: PreferenciaDeSons): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(p))
  } catch { /* navegacao privada; a sessao continua com o valor em memoria */ }
  if (mestre !== null) mestre.gain.value = p.ligado ? p.volume : 0
}

/**
 * Cria o `AudioContext` — nunca antes de precisar.
 *
 * Construir um no carregamento do modulo o deixaria `suspended` ate um gesto,
 * e no Safari gastaria a unica criacao barata. Aqui ele nasce no primeiro
 * gesto de verdade.
 */
function acordar(): AudioContext | null {
  if (contexto !== null) return contexto
  const Classe = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  if (Classe === undefined) return null
  try {
    contexto = new Classe()
    mestre = contexto.createGain()
    const p = lerPreferenciaDeSons()
    mestre.gain.value = p.ligado ? p.volume : 0
    mestre.connect(contexto.destination)
    return contexto
  } catch {
    return null
  }
}

/**
 * Destrava o audio dentro de um gesto da pessoa.
 *
 * Idempotente e barato, para poder ser chamado no topo de toda acao de
 * chamada: o navegador so libera o som dentro de uma ativacao, e a chamada ja
 * nasce de um clique.
 */
export function destravarSons(): void {
  const ctx = acordar()
  if (ctx === null) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

function tocarAgora(cue: Cue): void {
  const ctx = acordar()
  if (ctx === null || mestre === null) return

  const receita = CUES[cue]
  const agora = ctx.currentTime

  for (const nota of receita.notas) {
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = nota.hz

    const comeco = agora + nota.inicio
    const fim = comeco + nota.duracao
    // Ataque de 5ms e queda exponencial. Um portao seco produz um estalo
    // audivel — e estalo, numa chamada, le-se como defeito de audio.
    env.gain.setValueAtTime(0.0001, comeco)
    env.gain.exponentialRampToValueAtTime(receita.ganho, comeco + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, fim)

    osc.connect(env)
    env.connect(mestre)
    osc.start(comeco)
    osc.stop(fim + 0.02)
  }
}

/**
 * Toca uma deixa. Dispara e esquece, e NUNCA lanca.
 *
 * Um som que falha nao pode derrubar uma chamada — e a chamada e o produto.
 */
export function tocar(cue: Cue): void {
  try {
    const preferencia = lerPreferenciaDeSons()
    if (!preferencia.ligado) return

    const agora = Date.now()
    const anterior = ultimaVez.get(cue)
    if (anterior !== undefined && agora - anterior < INTERVALO_MINIMO_MS) return
    ultimaVez.set(cue, agora)

    if (injetado !== null) return injetado.tocar(cue)
    tocarAgora(cue)
  } catch {
    // Som e enfeite funcional. Nada aqui vale uma excecao subindo.
  }
}

/** Troca o emissor por um espiao. `null` devolve o de verdade. */
export function definirTocadorParaTeste(t: Tocador | null): void {
  injetado = t
  ultimaVez.clear()
}

/** Zera o limitador entre testes, para um nao calar o seguinte. */
export function esquecerIntervaloParaTeste(): void {
  ultimaVez.clear()
}
