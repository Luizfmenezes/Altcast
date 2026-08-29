import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'

/**
 * Os canais chegam ja filtrados pela visibilidade. A interface renderiza o que
 * recebeu e nada mais: nao existe ramo para "canal ao qual voce nao tem
 * acesso", porque esse canal nao chegou - e inventar um cadeado aqui contaria
 * justamente o que a spec 03 secao 9 manda nao contar.
 */
export function ListaCanais({ aoEscolher }: { aoEscolher?: () => void }): ReactNode {
  const channels = useStore(e => e.channels)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const canalAtivo = useStore(e => e.canalAtivo)
  const escolherCanal = useStore(e => e.escolherCanal)

  const doGrupo = channels.filter(c => c.groupId === grupoAtivo)

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="Canais"
      className="flex flex-col gap-0.5"
      style={{ padding: 'var(--space-row)' }}
    >
      {doGrupo.length === 0 && (
        <p className="px-2 py-3 text-xs text-fg-muted">
          Nenhum canal ainda. Crie o primeiro para comecar a conversa.
        </p>
      )}

      {doGrupo.map(canal => {
        const ativo = canal.id === canalAtivo
        return (
          <button
            key={canal.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => {
              escolherCanal(canal.id)
              aoEscolher?.()
            }}
            className={`flex items-center truncate rounded px-2 text-left text-sm
                        ${ativo
                          ? 'bg-bg-hover font-medium text-accent'
                          : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`}
            style={{ minHeight: 'var(--height-row)' }}
          >
            # {canal.name}
          </button>
        )
      })}
    </div>
  )
}
