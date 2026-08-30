import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Superficie elevada.
 *
 * A sombra tem deslocamento vertical e desfoque porque e assim que sombra
 * funciona; um halo sem deslocamento e so um contorno colorido fingindo
 * profundidade. Ela e discreta de proposito: no tema escuro quem separa a
 * superficie do fundo e a borda, nao a sombra, que praticamente some sobre
 * preto.
 */
export function Card({ className, children, ...resto }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      {...resto}
      className={cn(
        `rounded-xl border border-border-subtle bg-bg-raised
         shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12),0_2px_8px_-2px_rgb(0_0_0/0.10)]`,
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
    <h2 {...resto} className={cn('text-[15px] font-semibold leading-tight text-fg', className)}>
      {children}
    </h2>
  )
}

export function CardDescricao({ className, children, ...resto }: HTMLAttributes<HTMLParagraphElement>): ReactNode {
  return (
    <p {...resto} className={cn('text-[13px] leading-relaxed text-fg-muted', className)}>
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
