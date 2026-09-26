import * as Primitiva from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'

/**
 * Abas de verdade.
 *
 * O projeto tinha duas listas de abas feitas a mao, e as duas anunciavam
 * `role="tab"` sem responder a seta, a Home ou a End. Isso nao e um detalhe de
 * conformidade: um `role="tab"` diz ao leitor de tela "use as setas aqui", e
 * quando as setas nao fazem nada a pessoa fica presa num controle que o
 * proprio sistema disse que funcionaria. Tab sozinho percorreria cada aba uma
 * a uma, que e exatamente o que o padrao existe para evitar.
 *
 * A Radix resolve o roving tabindex, as setas, o `aria-controls` e a
 * associacao painel-aba. O que sobra aqui e a pintura.
 */

export type Aba = { valor: string; rotulo: string; icone?: LucideIcon }

export function Abas({
  abas, valor, aoMudar, rotulo, orientacao = 'horizontal', children,
}: {
  abas: Aba[]
  valor: string
  aoMudar: (v: string) => void
  /** Nome do conjunto para quem nao ve a moldura. */
  rotulo: string
  orientacao?: 'horizontal' | 'vertical'
  children: ReactNode
}): ReactNode {
  const vertical = orientacao === 'vertical'

  return (
    <Primitiva.Root
      value={valor}
      onValueChange={aoMudar}
      orientation={orientacao}
      className={cn('flex min-h-0', vertical ? 'flex-row' : 'flex-col')}
    >
      <Primitiva.List
        aria-label={rotulo}
        className={cn(
          vertical
            ? 'w-44 shrink-0 flex-col gap-0.5 border-r border-border-subtle p-2'
            : 'gap-1 overflow-x-auto border-b border-border-subtle px-4 pt-3',
          'flex',
        )}
      >
        {abas.map(({ valor: v, rotulo: r, icone: Icone }) => (
          <Primitiva.Trigger
            key={v}
            value={v}
            className={cn(
              'flex shrink-0 items-center gap-2 text-sm transition-colors',
              // 24px de alvo minimo, e o `py` garante isso nas duas orientacoes.
              'min-h-9 px-3 py-2',
              vertical
                ? `rounded-md text-left
                   data-[state=active]:bg-bg-hover data-[state=active]:text-fg
                   data-[state=inactive]:text-fg-muted hover:text-fg`
                : `rounded-t border-b-2
                   data-[state=active]:border-accent data-[state=active]:text-fg
                   data-[state=inactive]:border-transparent data-[state=inactive]:text-fg-muted
                   hover:text-fg`,
            )}
          >
            {Icone !== undefined && <Icone aria-hidden="true" className="size-4 shrink-0" />}
            <span className="truncate">{r}</span>
          </Primitiva.Trigger>
        ))}
      </Primitiva.List>

      {children}
    </Primitiva.Root>
  )
}

export function PainelDeAba({ valor, children }: {
  valor: string
  children: ReactNode
}): ReactNode {
  return (
    <Primitiva.Content
      value={valor}
      // Sem `outline-none` a Radix desenha um anel ao focar o painel
      // programaticamente, o que confunde com o foco de um controle real. O
      // anel dos controles internos continua intacto.
      className="min-w-0 flex-1 overflow-y-auto outline-none"
    >
      {children}
    </Primitiva.Content>
  )
}
