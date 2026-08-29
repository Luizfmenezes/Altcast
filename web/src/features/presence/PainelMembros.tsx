import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'
import { Presenca } from './Presenca.js'

const PESO_DO_PAPEL = { owner: 0, admin: 1, member: 2 } as const

/**
 * Coluna de 240px fixa. Ordena por presenca e depois por papel: quem esta
 * online agora e a informacao util numa conversa, e o papel so desempata.
 */
export function PainelMembros(): ReactNode {
  const members = useStore(e => e.members)
  const grupoAtivo = useStore(e => e.grupoAtivo)

  const doGrupo = members
    .filter(m => m.groupId === grupoAtivo)
    .sort((a, b) =>
      Number(b.status === 'online') - Number(a.status === 'online')
      || PESO_DO_PAPEL[a.role] - PESO_DO_PAPEL[b.role]
      || a.displayName.localeCompare(b.displayName))

  return (
    <aside
      aria-label="Membros"
      className="shrink-0 overflow-y-auto border-l border-border-subtle bg-bg-raised"
      style={{ width: 'var(--w-members)', padding: 'var(--space-row)' }}
    >
      <h2 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Membros
      </h2>
      <ul className="flex flex-col">
        {doGrupo.map(membro => (
          <li
            key={membro.userId}
            className="flex items-center justify-between gap-2 rounded px-2 text-sm"
            style={{ minHeight: 'var(--height-row)' }}
          >
            <span className="truncate text-fg">{membro.displayName}</span>
            <Presenca status={membro.status} />
          </li>
        ))}
      </ul>
    </aside>
  )
}
