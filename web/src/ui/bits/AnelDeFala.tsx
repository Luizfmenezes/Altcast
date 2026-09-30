import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * O anel verde em volta da foto de quem esta falando.
 *
 * E o sinal de fala do sistema inteiro, no lugar do "Fulano falando" em texto:
 * a foto acende, como no Discord. O olho acha quem fala numa lista de dez
 * sem ler nenhum nome, e o texto que piscava a cada silaba sai de cena.
 *
 * Duas camadas, as duas em `speaking`: um anel solido de 2px — a FORMA, que
 * vale sem cor para quem nao distingue verde — e um halo suave atras da foto,
 * que e o "fundo verde" e o que chama o olho de longe.
 *
 * A intensidade segue o nivel do audio (suavizado em 100ms pelo CSS). Quem nao
 * tem nivel medido — os outros participantes, cujo audio o cliente nao
 * analisa — recebe nivel cheio enquanto o SFU diz que estao falando.
 *
 * Sob `prefers-reduced-motion` o anel continua aparecendo, mas parado: o
 * estado e informacao, e a variacao era so o jeito de mostra-lo.
 */
export function AnelDeFala({ falando, nivel = 1, children, className }: {
  falando: boolean
  /** De 0 a 1. */
  nivel?: number
  children: ReactNode
  className?: string
}): ReactNode {
  const opacidade = falando ? 0.6 + Math.min(Math.max(nivel, 0), 1) * 0.4 : 0
  return (
    <span className={cn('relative inline-flex shrink-0 rounded-full', className)}>
      <span
        aria-hidden="true"
        className={cn(
          `pointer-events-none absolute -inset-[3px] rounded-full bg-speaking/35
           blur-[3px] transition-opacity duration-100 ease-out motion-reduce:transition-none`,
          falando && 'motion-reduce:opacity-100!',
        )}
        style={{ opacity: opacidade } as CSSProperties}
      />
      <span className="relative inline-flex rounded-full">{children}</span>
      <span
        aria-hidden="true"
        data-falando={falando ? 'sim' : undefined}
        className={cn(
          `pointer-events-none absolute -inset-[3px] rounded-full border-2 border-speaking
           transition-opacity duration-100 ease-out motion-reduce:transition-none`,
          // Parado e inteiro sob movimento reduzido: `!` vence o estilo inline.
          falando && 'motion-reduce:opacity-100!',
        )}
        style={{ opacity: falando ? 1 : 0 } as CSSProperties}
      />
    </span>
  )
}
