import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { usaMovimentoReduzido } from './movimento.js'

gsap.registerPlugin(SplitText)

/**
 * Um titulo que entra palavra por palavra.
 *
 * Adaptado do `SplitText` do React Bits (MIT + Commons Clause — ver
 * NOTICES.md). O GSAP e usado aqui, e nao no resto do app, porque este e o
 * unico caso em que ele faz algo que o `motion` nao faz de graca: o plugin
 * `SplitText` recorta o texto em elementos por palavra **e sabe desfazer o
 * recorte**, devolvendo o no original intacto. Reimplementar isso a mao e
 * exatamente como se quebra a selecao de texto e a copia.
 *
 * O cuidado que o original nao tem: o `revert()` no desmonte. Sem ele o DOM
 * fica com os `<div>` do recorte para sempre, e o texto — que para o leitor de
 * tela virou uma sequencia de caixas — nunca volta a ser uma frase.
 *
 * Por isso tambem o `aria-hidden` no elemento animado e o texto real num
 * `sr-only`: durante a animacao, o conteudo recortado e ruido para quem ouve.
 */
export function TituloFatiado({ texto, className }: {
  texto: string
  className?: string
}): ReactNode {
  const alvo = useRef<HTMLSpanElement>(null)
  const reduzido = usaMovimentoReduzido()

  useEffect(() => {
    const el = alvo.current
    if (el === null || reduzido) return

    let recorte: SplitText | null = null
    const contexto = gsap.context(() => {
      recorte = new SplitText(el, { type: 'words' })
      gsap.from(recorte.words, {
        opacity: 0,
        y: 14,
        duration: 0.5,
        // `power3.out` desacelera como coisa real. Nada de `back` nem
        // `elastic`: o repique e a assinatura mais datada que existe, e o
        // detector de design do projeto reprova.
        ease: 'power3.out',
        stagger: 0.045,
      })
    }, el)

    return () => {
      recorte?.revert()
      contexto.revert()
    }
  }, [texto, reduzido])

  return (
    <span className={className}>
      <span className="sr-only">{texto}</span>
      <span ref={alvo} aria-hidden="true">{texto}</span>
    </span>
  )
}
