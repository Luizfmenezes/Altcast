import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Contador de nao-lidas e rotulo curto.
 *
 * O numero e tabular: sem isso `1` e `7` tem larguras diferentes e a pilulinha
 * muda de tamanho conforme o conteudo, fazendo a lista inteira tremer a cada
 * mensagem que chega.
 */
export function Badge({
  children, tom = 'acento', className,
}: {
  children: ReactNode
  tom?: 'acento' | 'neutro' | 'perigo'
  className?: string
}): ReactNode {
  return (
    <span
      className={cn(
        `numerico inline-flex h-5 min-w-5 items-center justify-center rounded-full
         px-1.5 text-[11px] font-semibold leading-none`,
        tom === 'acento' && 'bg-accent text-accent-fg',
        tom === 'neutro' && 'bg-bg-hover text-fg-muted',
        tom === 'perigo' && 'bg-danger text-danger-fg',
        className,
      )}
    >
      {children}
    </span>
  )
}
