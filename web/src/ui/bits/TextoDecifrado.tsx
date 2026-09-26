import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usaMovimentoReduzido } from './movimento.js'

/**
 * O texto que se decifra ao aparecer.
 *
 * Adaptado do `DecryptedText` do React Bits (MIT + Commons Clause — ver
 * NOTICES.md), com o defeito de acessibilidade dele corrigido: o original
 * coloca o texto EMBARALHADO dentro do `sr-only`, de modo que um leitor de
 * tela recebe lixo aleatorio enquanto a animacao roda. Aqui o `sr-only`
 * carrega o texto REAL desde o primeiro quadro, e o embaralhado e
 * `aria-hidden` — como todo efeito visual deve ser.
 *
 * Roda uma vez, quando o texto muda, e para. A versao do React Bits oferece
 * `hover` e laco continuo; nenhum dos dois cabe num nome de canal, que e um
 * rotulo e nao um brinquedo.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*!?'
const PASSO_MS = 28

export function TextoDecifrado({ texto, className }: {
  texto: string
  className?: string
}): ReactNode {
  const reduzido = usaMovimentoReduzido()
  const [visivel, setVisivel] = useState(texto)
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (reduzido) {
      setVisivel(texto)
      return
    }

    let reveladas = 0
    const embaralhar = (): string => [...texto]
      .map((letra, i) => {
        if (i < reveladas || letra === ' ') return letra
        return ALFABETO[Math.floor(Math.random() * ALFABETO.length)] ?? letra
      })
      .join('')

    setVisivel(embaralhar())
    relogio.current = setInterval(() => {
      reveladas += 1
      setVisivel(embaralhar())
      if (reveladas >= texto.length && relogio.current !== null) {
        clearInterval(relogio.current)
        relogio.current = null
        setVisivel(texto)
      }
    }, PASSO_MS)

    return () => {
      if (relogio.current !== null) clearInterval(relogio.current)
      relogio.current = null
    }
  }, [texto, reduzido])

  return (
    <span className={className}>
      {/* O texto de verdade, para quem ouve — nunca o embaralhado. */}
      <span className="sr-only">{texto}</span>
      <span aria-hidden="true" className="font-mono tabular-nums">{visivel}</span>
    </span>
  )
}
