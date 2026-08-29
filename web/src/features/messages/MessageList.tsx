import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'
import type { Mensagem } from '../../lib/tipos.js'

/**
 * Regiao viva da conversa. O anuncio e agrupado e pausado enquanto o campo de
 * escrita esta focado - anunciar cada mensagem numa conversa movimentada
 * transforma leitor de tela em tortura, e interromper quem esta digitando e
 * pior ainda.
 */
/**
 * Referencia estavel para canal sem historico. Devolver `[]` novo dentro do
 * seletor faria o zustand ver estado diferente a cada renderizacao, e o
 * componente entraria em laco infinito de atualizacao.
 */
const VAZIO: Mensagem[] = []

export function MessageList({ escrevendo }: { escrevendo: boolean }): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const porCanal = useStore(e => e.mensagens)
  const members = useStore(e => e.members)
  const mensagens = canalAtivo === null ? VAZIO : porCanal[canalAtivo] ?? VAZIO

  const nomeDe = (autorId: string | null): string =>
    autorId === null
      ? 'usuario removido'
      : members.find(m => m.userId === autorId)?.displayName ?? 'usuario removido'

  return (
    <div
      role="log"
      aria-label="Mensagens"
      aria-live={escrevendo ? 'off' : 'polite'}
      aria-relevant="additions"
      className="flex flex-1 flex-col overflow-y-auto"
      style={{ padding: 'var(--space-gutter)', gap: 'var(--space-row)' }}
    >
      {mensagens.length === 0 && (
        <p className="text-sm text-fg-muted">
          Nenhuma mensagem ainda. Escreva a primeira abaixo.
        </p>
      )}

      {mensagens.map(mensagem => (
        <article
          key={mensagem.id}
          className={mensagem.envio === 'enviando' ? 'opacity-60' : undefined}
        >
          <p className="text-xs text-fg-muted">{nomeDe(mensagem.authorId)}</p>
          <p className="whitespace-pre-wrap break-words text-sm text-fg">{mensagem.content}</p>
        </article>
      ))}
    </div>
  )
}
