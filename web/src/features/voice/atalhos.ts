import { useEffect } from 'react'
import { useChamadaAtiva } from './chamadaAtiva.js'

/**
 * Push-to-talk e os atalhos da chamada.
 *
 * Os dois moram juntos porque compartilham a regra que mais importa aqui, e
 * que e facil de esquecer: nunca capturar uma tecla com o foco num campo de
 * texto. Sem ela, escrever "amanha" no chat silenciaria o microfone no "m" e
 * ensurdeceria no primeiro "d" — e a pessoa nao teria como relacionar as duas
 * coisas.
 */

export type ModoDeFala = 'aberto' | 'apertar'

/**
 * Uma combinacao de teclas: a tecla fisica mais os modificadores exatos.
 *
 * Exatos, e nao "pelo menos": `Ctrl+M` gravado nao pode disparar com
 * `Ctrl+Shift+M`, que o navegador ou outro atalho do sistema pode estar usando.
 */
export type Atalho = {
  /** O `event.code`: a POSICAO da tecla, estavel entre layouts. */
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type PreferenciasDeFala = {
  modo: ModoDeFala
  /** O `event.code` da tecla, e nao o `key`: veja o comentario abaixo. */
  tecla: string
  /** Mutar e desmutar o microfone. `null` desliga o atalho. */
  mudo: Atalho | null
  /** Ensurdecer. `null` desliga o atalho. */
  surdo: Atalho | null
}

export const semModificador = (code: string): Atalho =>
  ({ code, ctrl: false, alt: false, shift: false, meta: false })

const CHAVE_DE_FALA = 'altcast:fala'

/** O evento que avisa os atalhos vivos de que a preferencia mudou. */
const EVENTO_DE_FALA = 'altcast:fala'

/**
 * `Space` por padrao, e guardado como `code` e nao como `key`.
 *
 * `key` depende do LAYOUT: a mesma tecla fisica devolve "q" num teclado
 * QWERTY e "a" num AZERTY, e um atalho gravado num layout deixaria de
 * funcionar no outro. `code` descreve a POSICAO fisica, que e o que a pessoa
 * de fato memoriza com o dedo.
 */
export const FALA_PADRAO: PreferenciasDeFala = {
  modo: 'aberto',
  tecla: 'Space',
  mudo: semModificador('KeyM'),
  surdo: semModificador('KeyD'),
}

export function lerFala(): PreferenciasDeFala {
  try {
    const bruto = localStorage.getItem(CHAVE_DE_FALA)
    if (bruto === null) return FALA_PADRAO
    // A gravacao antiga so tinha `modo` e `tecla`: o que falta vem do padrao.
    return { ...FALA_PADRAO, ...JSON.parse(bruto) as Partial<PreferenciasDeFala> }
  } catch {
    return FALA_PADRAO
  }
}

export function guardarFala(fala: PreferenciasDeFala): void {
  try {
    localStorage.setItem(CHAVE_DE_FALA, JSON.stringify(fala))
  } catch {
    // Nao poder lembrar a escolha nao pode impedir de faze-la agora.
  }
  // Trocar a tecla no meio da chamada vale na hora, sem sair e entrar.
  window.dispatchEvent(new Event(EVENTO_DE_FALA))
}

/** As teclas que sozinhas nao sao atalho: so modificam outra. */
const MODIFICADORES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
])

export function ehModificador(code: string): boolean {
  return MODIFICADORES.has(code)
}

export function atalhoDoEvento(evento: KeyboardEvent): Atalho {
  return {
    code: evento.code,
    ctrl: evento.ctrlKey,
    alt: evento.altKey,
    shift: evento.shiftKey,
    meta: evento.metaKey,
  }
}

export function combina(evento: KeyboardEvent, atalho: Atalho | null): boolean {
  return atalho !== null
    && evento.code === atalho.code
    && evento.ctrlKey === atalho.ctrl
    && evento.altKey === atalho.alt
    && evento.shiftKey === atalho.shift
    && evento.metaKey === atalho.meta
}

export function mesmoAtalho(a: Atalho | null, b: Atalho | null): boolean {
  return a !== null && b !== null && a.code === b.code && a.ctrl === b.ctrl
    && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta
}

const NOMES_DE_TECLA: Record<string, string> = {
  Space: 'Espaço', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: 'Ç',
  Quote: '~', Comma: ',', Period: '.', Slash: ';', IntlRo: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  CapsLock: 'Caps Lock', PageUp: 'Page Up', PageDown: 'Page Down',
  ScrollLock: 'Scroll Lock', Backspace: 'Backspace',
}

/** O nome que a pessoa reconhece, a partir do `code` fisico (layout ABNT2). */
export function nomeDaTecla(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return NOMES_DE_TECLA[code] ?? code
}

export function rotuloDoAtalho(atalho: Atalho | null): string {
  if (atalho === null) return 'Nenhum'
  const partes: string[] = []
  if (atalho.ctrl) partes.push('Ctrl')
  if (atalho.alt) partes.push('Alt')
  if (atalho.shift) partes.push('Shift')
  if (atalho.meta) partes.push('Meta')
  partes.push(nomeDaTecla(atalho.code))
  return partes.join(' + ')
}

/**
 * Quanto tempo o microfone continua aberto depois de a tecla ser solta.
 *
 * Sem esta folga a ultima silaba e cortada, sempre: a pessoa solta a tecla no
 * mesmo instante em que termina de falar, e o corte cai exatamente em cima do
 * fim da palavra. Duzentos milissegundos e curto o bastante para nao vazar a
 * frase seguinte e longo o bastante para salvar a anterior.
 */
export const FOLGA_DE_SOLTURA_MS = 200

/**
 * Digitando num campo de texto, nenhuma tecla e atalho.
 *
 * `isContentEditable` cobre o caso que um teste de `tagName` sozinho perde: um
 * editor rico e uma `div`, e nao um `input`.
 */
export function escrevendoEm(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  // As duas formas, e nao so a propriedade: `isContentEditable` e calculada e
  // herdada — o que a torna a resposta certa para um elemento DENTRO de um
  // editor —, mas nem todo ambiente a implementa. O atributo cobre o resto.
  if (alvo.isContentEditable) return true
  if (alvo.closest('[contenteditable="true"],[contenteditable=""]') !== null) return true
  const nome = alvo.tagName
  return nome === 'INPUT' || nome === 'TEXTAREA' || nome === 'SELECT'
}

/**
 * Liga os atalhos globais da chamada enquanto houver uma chamada.
 *
 * `M` muda e `D` ensurdece por padrao, e os dois podem ser trocados nas
 * configuracoes por qualquer combinacao. Sem modificador, a protecao contra o
 * disparo acidental e a checagem de foco acima; COM modificador (`Ctrl+M`), o
 * atalho vale ate digitando — ninguem aperta `Ctrl+Shift+M` escrevendo texto.
 *
 * Push-to-talk tem um limite conhecido, e ele esta documentado em vez de
 * escondido: FORA da aba o navegador nao entrega a tecla. Uma extensao
 * resolveria; nao ha como resolver so com a pagina.
 */
export function useAtalhosDaChamada(): void {
  const canal = useChamadaAtiva(e => e.canal)
  const alternarMicrofone = useChamadaAtiva(e => e.alternarMicrofone)
  const alternarSurdo = useChamadaAtiva(e => e.alternarSurdo)
  const definirMicrofone = useChamadaAtiva(e => e.definirMicrofone)

  useEffect(() => {
    if (canal === null) return
    let fala = lerFala()
    const aoMudarPreferencia = (): void => { fala = lerFala() }
    /** O temporizador da folga de soltura. Um por vez. */
    let soltura: ReturnType<typeof setTimeout> | null = null
    /** Evita repetir o ligamento enquanto a tecla fica presa (auto-repeat). */
    let falando = false

    const aoApertar = (evento: KeyboardEvent): void => {
      const escrevendo = escrevendoEm(evento.target)

      // O auto-repeat de uma tecla segurada nao pode alternar o mudo dezenas
      // de vezes por segundo.
      if (!evento.repeat) {
        const atalhos = [[fala.mudo, alternarMicrofone], [fala.surdo, alternarSurdo]] as const
        for (const [atalho, acao] of atalhos) {
          if (atalho === null || !combina(evento, atalho)) continue
          if (escrevendo && !(atalho.ctrl || atalho.alt || atalho.meta)) return
          evento.preventDefault()
          acao()
          return
        }
      }

      if (escrevendo) return

      if (fala.modo === 'apertar' && evento.code === fala.tecla) {
        // `preventDefault` porque a tecla padrao e o espaco, que rolaria a
        // pagina a cada palavra dita.
        evento.preventDefault()
        if (soltura !== null) {
          clearTimeout(soltura)
          soltura = null
        }
        if (falando) return
        falando = true
        definirMicrofone(true)
      }
    }

    const aoSoltar = (evento: KeyboardEvent): void => {
      if (fala.modo !== 'apertar' || evento.code !== fala.tecla) return
      soltura = setTimeout(() => {
        falando = false
        definirMicrofone(false)
        soltura = null
      }, FOLGA_DE_SOLTURA_MS)
    }

    /**
     * Perder o foco da janela solta o microfone na hora, sem folga.
     *
     * E o unico remedio possivel para o limite do push-to-talk: se a tecla for
     * solta com a aba em segundo plano, o `keyup` nunca chega e o microfone
     * ficaria aberto indefinidamente. Melhor cortar cedo do que transmitir sem
     * querer.
     */
    const aoPerderFoco = (): void => {
      if (!falando) return
      falando = false
      definirMicrofone(false)
    }

    window.addEventListener('keydown', aoApertar)
    window.addEventListener('keyup', aoSoltar)
    window.addEventListener('blur', aoPerderFoco)
    window.addEventListener(EVENTO_DE_FALA, aoMudarPreferencia)
    return () => {
      if (soltura !== null) clearTimeout(soltura)
      window.removeEventListener('keydown', aoApertar)
      window.removeEventListener('keyup', aoSoltar)
      window.removeEventListener('blur', aoPerderFoco)
      window.removeEventListener(EVENTO_DE_FALA, aoMudarPreferencia)
    }
  }, [canal, alternarMicrofone, alternarSurdo, definirMicrofone])
}
