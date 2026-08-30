import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Divisor decorativo. `role="none"` porque um <hr> semantico seria anunciado
 * como quebra tematica, e uma linha entre dois grupos de botoes nao e uma
 * mudanca de assunto.
 */
export function Separador({
  orientacao = 'horizontal', className,
}: {
  orientacao?: 'horizontal' | 'vertical'
  className?: string
}): ReactNode {
  return (
    <div
      role="none"
      className={cn(
        'shrink-0 bg-border-subtle',
        orientacao === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  )
}
