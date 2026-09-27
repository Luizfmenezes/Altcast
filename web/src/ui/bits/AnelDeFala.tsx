import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * O anel "no ar" em volta de quem esta falando.
 *
 * E a assinatura visual do Design System v2: o ambar vivo (`accentLive`)
 * aparece em um lugar so do produto inteiro — em volta de quem esta
 * transmitindo AGORA. Derivado da ideia do "Glow" do React Bits, mas sem
 * sombra difusa: um anel de 2px, que e forma, e nao so cor.
 *
 * A opacidade segue o nivel do audio (suavizado em 100ms pelo CSS). Quem nao
 * tem nivel medido — os outros participantes, cujo audio o cliente nao
 * analisa — recebe nivel cheio enquanto o SFU diz que estao falando.
 *
 * Sob `prefers-reduced-motion` o anel continua aparecendo, mas parado: o
 * estado e informacao, e a pulsacao era so o jeito de mostra-lo.
 */
export function AnelDeFala({ falando, nivel = 1, children, className }: {
  falando: boolean
  /** De 0 a 1. */
  nivel?: number
  children: ReactNode
  className?: string
}): ReactNode {
  const opacidade = falando ? 0.45 + Math.min(Math.max(nivel, 0), 1) * 0.55 : 0
  return (
    <span className={cn('relative inline-flex shrink-0 rounded-full', className)}>
      {children}
      <span
        aria-hidden="true"
        data-falando={falando ? 'sim' : undefined}
        className={cn(
          `pointer-events-none absolute -inset-[3px] rounded-full border-2 border-accent-live
           transition-opacity duration-100 ease-out motion-reduce:transition-none`,
          // Parado e inteiro sob movimento reduzido: `!` vence o estilo inline.
          falando && 'motion-reduce:opacity-100!',
        )}
        style={{ opacity: opacidade } as CSSProperties}
      />
    </span>
  )
}
