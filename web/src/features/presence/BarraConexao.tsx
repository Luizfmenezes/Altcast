import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'
import type { SocketStatus } from '../../lib/socket.js'

const TEXTO: Record<SocketStatus, string> = {
  conectado: 'Conectado',
  reconectando: 'Reconectando ao servidor…',
  offline: 'Sem conexão. As mensagens novas chegam assim que a rede voltar.',
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

  /**
   * Tudo bem nao ocupa espaco. A calha permanente gastava uma linha da tela
   * inteira para dizer "conectado — 38 ms" o dia todo, e a latencia estava
   * DENTRO da regiao viva: a cada ping, o leitor de tela anunciava um numero
   * novo. Agora a calha aparece quando ha algo a dizer, e a regiao viva so
   * fala da conexao — nunca do numero.
   *
   * A regiao continua montada quando esta tudo bem, vazia: um `role=status`
   * que nasce junto com o texto nao e anunciado por boa parte dos leitores,
   * e "reconectando" e exatamente o que precisa ser ouvido.
   */
  return (
    <div
      className={conectado
        ? 'sr-only'
        : `flex shrink-0 items-center gap-2 border-t border-border-subtle bg-bg-raised
           px-3 py-1.5 text-xs text-fg`}
    >
      {!conectado && (
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${
            conexao === 'reconectando' ? 'bg-warning motion-safe:animate-pulse' : 'bg-danger'}`}
        />
      )}
      <span role="status" aria-live="polite" aria-label="Estado da conexão">
        {conectado ? '' : TEXTO[conexao]}
      </span>
      {/* O numero fica fora da regiao viva: e medida, nao acontecimento. */}
      {conectado && latenciaMs !== null && latenciaMs !== undefined && (
        <span className="sr-only">Latência de {latenciaMs} ms</span>
      )}
    </div>
  )
}
