import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { House, MessageCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { cn } from '../../lib/utils.js'

export type AbaMovel = 'inicio' | 'conversas' | 'voce'

/**
 * A barra de abas do celular, presa ao pe da tela.
 *
 * Tres destinos, e nao cinco: o que a pessoa faz no celular e ver o que
 * chegou, responder alguem e ajustar a propria conta. Tudo o mais — canais,
 * chamada, membros — esta DENTRO desses tres, a um toque.
 *
 * O rotulo fica sempre escrito: icone sozinho num app de conversa obriga a
 * adivinhar, e a aba e o lugar mais tocado da tela inteira.
 */
export function BarraDeAbas({ aba, aoTrocar, naoLidas }: {
  aba: AbaMovel
  aoTrocar: (aba: AbaMovel) => void
  naoLidas: { inicio: number; conversas: number }
}): ReactNode {
  const user = useStore(e => e.user)

  const itens: { id: AbaMovel; rotulo: string; Icone?: LucideIcon; contagem: number }[] = [
    { id: 'inicio', rotulo: 'Início', Icone: House, contagem: naoLidas.inicio },
    { id: 'conversas', rotulo: 'Conversas', Icone: MessageCircle, contagem: naoLidas.conversas },
    { id: 'voce', rotulo: 'Você', contagem: 0 },
  ]

  return (
    <nav
      aria-label="Navegação principal"
      className="relative z-10 shrink-0 rounded-t-[28px] border-t border-border-subtle bg-bg-raised
                 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)]"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-3 pt-2">
        {itens.map(({ id, rotulo, Icone, contagem }) => {
          const ativa = aba === id
          return (
            <li key={id} className="flex flex-1 justify-center">
              <button
                type="button"
                onClick={() => aoTrocar(id)}
                aria-current={ativa ? 'page' : undefined}
                className={cn(
                  'relative flex min-w-16 flex-col items-center gap-1 rounded-2xl px-3 py-1.5 text-xs font-medium',
                  'transition-colors',
                  ativa ? 'text-fg' : 'text-fg-muted active:text-fg',
                )}
              >
                {ativa && (
                  <motion.span
                    layoutId="aba-ativa-movel"
                    aria-hidden="true"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-2xl bg-bg-hover"
                  />
                )}
                <span className="relative flex size-7 items-center justify-center">
                  {Icone === undefined ? (
                    <Avatar
                      nome={user?.displayName ?? 'Você'}
                      url={user?.avatarUrl ?? null}
                      tamanho="sm"
                      className={cn(ativa && 'ring-2 ring-fg ring-offset-2 ring-offset-bg-hover')}
                    />
                  ) : (
                    <Icone aria-hidden="true" className="size-[22px]" strokeWidth={ativa ? 2.25 : 1.75} />
                  )}
                  {contagem > 0 && (
                    <span
                      aria-hidden="true"
                      className="numerico absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center
                                 justify-center rounded-full bg-accent px-1 text-xs font-semibold leading-none
                                 text-accent-fg ring-2 ring-bg-raised"
                    >
                      {contagem > 99 ? '99+' : contagem}
                    </span>
                  )}
                </span>
                <span className="relative">{rotulo}</span>
                {contagem > 0 && <span className="sr-only">, {contagem} não lidas</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
