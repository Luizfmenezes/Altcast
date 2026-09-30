import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Link2, Reply } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { enderecoDaMensagem } from '../../lib/rotaDoCanal.js'
import { cn } from '../../lib/utils.js'
import type { Mensagem } from '../../lib/tipos.js'
import { SeletorDeReacao, useAlternarReacao } from './Reacoes.js'

/** Os tres que ficam a um clique, sem abrir o seletor. */
const RAPIDAS = ['👍', '❤️', '😂'] as const

/**
 * A barra de acoes flutuante de uma mensagem.
 *
 * "Reagir · Responder" sublinhado embaixo de TODA mensagem era o cromo pesando
 * tanto quanto o conteudo — e dobrava a altura da conversa no celular. As
 * acoes continuam a um gesto, mas so aparecem onde a atencao ja esta: no hover,
 * no foco do teclado (qualquer botao daqui dentro recebe Tab normalmente) e no
 * toque na mensagem.
 *
 * Continua no DOM o tempo todo, so invisivel: um controle que some da arvore
 * no desfoque nao e alcancavel por quem navega por Tab, que e justamente quem
 * nao tem hover.
 */
export function AcoesDaMensagem({ mensagem, eu, visivel, aoResponder }: {
  mensagem: Mensagem
  eu: string | null
  /** Forcada pelo toque: no celular nao ha hover. */
  visivel: boolean
  aoResponder?: (mensagem: Mensagem) => void
}): ReactNode {
  const reacoes = mensagem.reactions ?? []
  const { alternar } = useAlternarReacao(mensagem.id, reacoes, eu)
  const [seletorAberto, setSeletorAberto] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const grupo = useStore(e => e.channels.find(c => c.id === mensagem.channelId)?.groupId ?? null)

  /**
   * O link direto da mensagem (Etapa 2.1): quem abre cai no canal, com a
   * mensagem rolada ate o meio da tela e realcada.
   */
  async function copiarLink(): Promise<void> {
    if (grupo === null) return
    try {
      await navigator.clipboard.writeText(enderecoDaMensagem(grupo, mensagem.channelId, mensagem.id))
      setCopiado(true)
      setTimeout(() => { setCopiado(false) }, 1500)
    } catch {
      // Area de transferencia negada: o botao simplesmente nao confirma.
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Ações da mensagem"
      className={cn(
        `absolute -top-4 right-2 z-10 flex items-center gap-0.5 rounded-lg border
         border-border-subtle bg-bg-raised p-0.5 shadow-popover transition-opacity
         duration-120 ease-out`,
        visivel || seletorAberto
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover/mensagem:pointer-events-auto group-hover/mensagem:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
      )}
    >
      {RAPIDAS.map(emoji => (
        <button
          key={emoji}
          type="button"
          onClick={() => { alternar(emoji) }}
          aria-label={`Reagir com ${emoji}`}
          className="inline-flex size-8 items-center justify-center rounded text-base
                     hover:bg-bg-hover focus-visible:bg-bg-hover"
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
      <SeletorDeReacao
        messageId={mensagem.id}
        reacoes={reacoes}
        eu={eu}
        aoAbrir={setSeletorAberto}
      />
      <button
        type="button"
        onClick={() => { void copiarLink() }}
        aria-label={copiado ? 'Link copiado' : 'Copiar link da mensagem'}
        title={copiado ? 'Link copiado' : 'Copiar link da mensagem'}
        className="inline-flex size-8 items-center justify-center rounded text-fg-muted
                   hover:bg-bg-hover hover:text-fg focus-visible:bg-bg-hover"
      >
        {copiado
          ? <Check aria-hidden="true" className="size-4 text-presence-online" />
          : <Link2 aria-hidden="true" className="size-4" />}
      </button>
      {/* A confirmacao falada, sem roubar o foco de quem copiou. */}
      <span role="status" className="sr-only">{copiado ? 'Link copiado' : ''}</span>
      {aoResponder !== undefined && (
        <button
          type="button"
          onClick={() => { aoResponder(mensagem) }}
          aria-label="Responder"
          title="Responder"
          className="inline-flex size-8 items-center justify-center rounded text-fg-muted
                     hover:bg-bg-hover hover:text-fg focus-visible:bg-bg-hover"
        >
          <Reply aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  )
}
