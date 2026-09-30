import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Liga/desliga, com cara de liga/desliga.
 *
 * Um checkbox nativo faz o trabalho, mas diz "marcar item de lista"; um
 * recurso que passa a valer na hora pede o interruptor. Continua sendo um
 * botao com `role="switch"` e `aria-checked`, que e o que o leitor de tela
 * anuncia como "ligado"/"desligado" — a forma e so o que o olho ve.
 */
export function Interruptor({ ligado, aoMudar, id, desabilitado = false, rotulo }: {
  ligado: boolean
  aoMudar: (ligado: boolean) => void
  id?: string
  desabilitado?: boolean
  /** Quando nao ha `<label htmlFor>` apontando para ele. */
  rotulo?: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => { aoMudar(!ligado) }}
      className={cn(
        `relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors
         duration-150 disabled:cursor-not-allowed disabled:opacity-50`,
        ligado ? 'border-accent bg-accent' : 'border-border bg-bg-sunken',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-4 rounded-full shadow-popover transition-transform duration-150 ease-out',
          ligado ? 'translate-x-[18px] bg-accent-fg' : 'translate-x-[3px] bg-fg-muted',
        )}
      />
    </button>
  )
}
