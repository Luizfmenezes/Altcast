import * as Primitiva from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Um unico provedor no topo da arvore controla os atrasos de todas as dicas.
 * `skipDelayDuration` e o que faz percorrer uma fileira de icones mostrar a
 * segunda dica na hora, em vez de esperar de novo a cada icone.
 */
export function ProvedorDeDicas({ children }: { children: ReactNode }): ReactNode {
  return (
    <Primitiva.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </Primitiva.Provider>
  )
}

/**
 * Dica de ferramenta.
 *
 * Nunca e o unico lugar onde a informacao existe: quem navega por toque nao
 * tem hover, e a Radix so a revela ao foco ou ao ponteiro. Todo gatilho que
 * depende dela tambem carrega um rotulo acessivel proprio.
 */
export function Dica({
  texto, atalho, lado = 'right', children,
}: {
  texto: string
  atalho?: string
  lado?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}): ReactNode {
  return (
    <Primitiva.Root>
      <Primitiva.Trigger asChild>{children}</Primitiva.Trigger>
      <Primitiva.Portal>
        <Primitiva.Content
          side={lado}
          sideOffset={8}
          className={cn(
            `z-50 flex items-center gap-2 rounded-md border border-border-subtle
             bg-bg-raised px-2.5 py-1.5 text-[13px] font-medium text-fg
             shadow-[0_2px_4px_-2px_rgb(0_0_0/0.20),0_6px_16px_-4px_rgb(0_0_0/0.18)]
             select-none
             data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0
             data-[state=delayed-open]:zoom-in-95
             data-[state=closed]:animate-out data-[state=closed]:fade-out-0`,
          )}
        >
          {texto}
          {atalho !== undefined && (
            <span className="font-mono text-[10px] text-fg-muted">{atalho}</span>
          )}
          <Primitiva.Arrow className="fill-bg-raised" width={10} height={5} />
        </Primitiva.Content>
      </Primitiva.Portal>
    </Primitiva.Root>
  )
}
