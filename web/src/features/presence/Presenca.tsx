import type { ReactNode } from 'react'

/**
 * Presenca nunca e so cor: circulo cheio para online, vazado para offline, e o
 * rotulo textual sempre presente. Quem nao distingue verde de cinza precisa da
 * forma e da palavra (SC 1.4.1).
 */
export function Presenca({ status }: { status: 'online' | 'offline' }): ReactNode {
  const online = status === 'online'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        data-presenca={online ? 'cheio' : 'vazado'}
        className={`size-2 rounded-full border ${
          online
            ? 'border-presence-online bg-presence-online'
            : 'border-fg-muted bg-transparent'
        }`}
      />
      <span className="text-[11px] text-fg-muted">{status}</span>
    </span>
  )
}
