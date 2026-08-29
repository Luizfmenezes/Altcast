import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variante = 'primario' | 'discreto' | 'perigo'

const ESTILOS: Record<Variante, string> = {
  primario: 'bg-accent text-accent-fg hover:opacity-90',
  discreto: 'bg-bg-raised text-fg border border-border hover:bg-bg-hover',
  perigo: 'bg-danger text-danger-fg hover:opacity-90',
}

/**
 * Altura minima de 36px cobre com folga o alvo de 24x24 exigido pela SC 2.5.8,
 * e a folha de tokens amplia para 44px onde a entrada e por toque.
 */
export function Botao({
  variante = 'primario', children, ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }): ReactNode {
  return (
    <button
      {...resto}
      className={`inline-flex h-9 min-w-[24px] items-center justify-center gap-2
                  rounded px-3 text-sm font-medium transition-opacity
                  disabled:cursor-not-allowed disabled:opacity-60 ${ESTILOS[variante]}`}
    >
      {children}
    </button>
  )
}
