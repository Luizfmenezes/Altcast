import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Tecla de atalho.
 *
 * Monoespacada aqui nao e fantasia de "tecnico": e a medida de uma tecla real,
 * e `Alt` ao lado de `K` precisa ter a largura de caractere que o teclado tem.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <kbd
      className={cn(
        `inline-flex h-5 select-none items-center justify-center gap-0.5 rounded
         border border-border-subtle bg-bg px-1.5 font-mono text-[10px]
         font-medium text-fg-muted`,
        className,
      )}
    >
      {children}
    </kbd>
  )
}
