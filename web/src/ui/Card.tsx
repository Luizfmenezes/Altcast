import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Uma secao agrupada.
 *
 * AFUNDADA, e nao elevada (Design System v2). Quase todo cartao do app mora
 * dentro de algo ja elevado — um dialogo, uma coluna —, e cartao elevado
 * dentro de superficie elevada e o "cartao dentro de cartao": duas bordas, duas
 * sombras e nenhuma hierarquia. O fundo `bgSunken` diz "isto e um grupo" sem
 * competir com o dialogo que o contem.
 */
export function Card({ className, children, ...resto }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      {...resto}
      className={cn(
        'rounded-lg border border-border-subtle bg-bg-sunken',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardCabecalho({ className, children, ...resto }: HTMLAttributes<HTMLDivElement>): ReactNode {
  // Mais espaco acima do titulo do que abaixo: o titulo pertence ao que vem
  // depois dele, e o espaco e quem diz isso.
  return (
    <div {...resto} className={cn('flex flex-col gap-1 px-5 pb-3 pt-5', className)}>
      {children}
    </div>
  )
}

export function CardTitulo({ className, children, ...resto }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return (
    <h2 {...resto} className={cn('text-base font-semibold leading-tight text-fg', className)}>
      {children}
    </h2>
  )
}

export function CardDescricao({ className, children, ...resto }: HTMLAttributes<HTMLParagraphElement>): ReactNode {
  return (
    <p {...resto} className={cn('text-sm leading-relaxed text-fg-muted', className)}>
      {children}
    </p>
  )
}

export function CardCorpo({ className, children, ...resto }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div {...resto} className={cn('px-5 pb-5', className)}>{children}</div>
}

export function CardRodape({ className, children, ...resto }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div {...resto} className={cn('flex items-center gap-2 border-t border-border-subtle px-5 py-3.5', className)}>
      {children}
    </div>
  )
}
