import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'

/**
 * Coluna de 64px, largura fixa. Nao muda de largura com nome longo nem com
 * hover: dimensao estavel e requisito, e nao detalhe - a barra lateral que
 * pula ao passar o mouse obriga a reencontrar o alvo a cada movimento.
 */
export function BarraGrupos(): ReactNode {
  const groups = useStore(e => e.groups)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const escolherGrupo = useStore(e => e.escolherGrupo)

  return (
    <nav
      aria-label="Grupos"
      className="flex shrink-0 flex-col items-center gap-2 border-r border-border-subtle
                 bg-bg-raised py-3"
      style={{ width: 'var(--w-groups)' }}
    >
      {groups.map(grupo => {
        const ativo = grupo.id === grupoAtivo
        return (
          <button
            key={grupo.id}
            type="button"
            onClick={() => escolherGrupo(grupo.id)}
            aria-current={ativo ? 'true' : undefined}
            className={`flex size-10 items-center justify-center rounded text-sm font-semibold
                        ${ativo
                          ? 'bg-accent text-accent-fg'
                          : 'bg-bg-hover text-fg-muted hover:text-fg'}`}
          >
            {grupo.iconUrl === null
              ? <span aria-hidden="true">{grupo.name.slice(0, 1).toUpperCase()}</span>
              : <img src={grupo.iconUrl} alt="" className="size-10 rounded" />}
            <span className="sr-only">{grupo.name}</span>
          </button>
        )
      })}
    </nav>
  )
}
