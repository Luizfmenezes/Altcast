import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'
import type { SocketStatus } from '../../lib/socket.js'

const TEXTO: Record<SocketStatus, string> = {
  conectado: 'conectado',
  reconectando: 'reconectando',
  offline: 'offline',
}

/**
 * O detalhe memoravel do produto: uma calha fina e permanente que diz a verdade
 * sobre o tempo real.
 *
 * Quase todo chat esconde isso e deixa a pessoa falando no vazio sem saber.
 * Como toda a arquitetura foi desenhada em torno de "o WebSocket pode falhar e
 * o REST cura", exibir esse estado e a expressao visual da alma do sistema, e
 * nao enfeite. Na Fatia 2 ela cresce para mostrar qualidade de midia por
 * participante, sem redesenho - o lugar ja existe.
 */
export function BarraConexao({ latenciaMs }: { latenciaMs?: number | null }): ReactNode {
  const conexao = useStore(e => e.conexao)
  const conectado = conexao === 'conectado'

  return (
    <div
      role="status"
      // `status` ja implica polite; explicitar evita depender de o leitor de
      // tela derivar o valor implicito do papel.
      aria-live="polite"
      aria-label="Estado da conexao"
      className="flex shrink-0 items-center gap-2 border-t border-border-subtle bg-bg-raised
                 px-3 py-1 text-[11px] text-fg-muted"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full border ${
          conectado
            ? 'border-presence-online bg-presence-online'
            : 'border-fg-muted bg-transparent'
        }`}
      />
      <span>{TEXTO[conexao]}</span>
      {conectado && latenciaMs !== null && latenciaMs !== undefined && (
        <span className="font-mono">- {latenciaMs} ms</span>
      )}
    </div>
  )
}
