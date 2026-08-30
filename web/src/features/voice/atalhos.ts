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

export type PreferenciasDeFala = {
  modo: ModoDeFala
  /** O `event.code` da tecla, e nao o `key`: veja o comentario abaixo. */
  tecla: string
}

const CHAVE_DE_FALA = 'altcast:fala'

/**
 * `Space` por padrao, e guardado como `code` e nao como `key`.
 *
 * `key` depende do LAYOUT: a mesma tecla fisica devolve "q" num teclado
 * QWERTY e "a" num AZERTY, e um atalho gravado num layout deixaria de
 * funcionar no outro. `code` descreve a POSICAO fisica, que e o que a pessoa
 * de fato memoriza com o dedo.
 */
export const FALA_PADRAO: PreferenciasDeFala = { modo: 'aberto', tecla: 'Space' }

export function lerFala(): PreferenciasDeFala {
  try {
    const bruto = localStorage.getItem(CHAVE_DE_FALA)
    if (bruto === null) return FALA_PADRAO
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
 * `M` muda, `D` ensurdece. Sem modificador porque e o que a memoria muscular
 * de quem vem do Discord espera, e a protecao contra o disparo acidental e a
 * checagem de foco acima — nao um `Ctrl` que ninguem lembraria.
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
    const fala = lerFala()
    /** O temporizador da folga de soltura. Um por vez. */
    let soltura: ReturnType<typeof setTimeout> | null = null
    /** Evita repetir o ligamento enquanto a tecla fica presa (auto-repeat). */
    let falando = false

    const aoApertar = (evento: KeyboardEvent): void => {
      if (escrevendoEm(evento.target)) return

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
        return
      }

      // O auto-repeat de uma tecla segurada nao pode alternar o mudo dezenas
      // de vezes por segundo.
      if (evento.repeat || evento.ctrlKey || evento.metaKey || evento.altKey) return
      if (evento.code === 'KeyM') { evento.preventDefault(); alternarMicrofone() }
      if (evento.code === 'KeyD') { evento.preventDefault(); alternarSurdo() }
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
    return () => {
      if (soltura !== null) clearTimeout(soltura)
      window.removeEventListener('keydown', aoApertar)
      window.removeEventListener('keyup', aoSoltar)
      window.removeEventListener('blur', aoPerderFoco)
    }
  }, [canal, alternarMicrofone, alternarSurdo, definirMicrofone])
}
