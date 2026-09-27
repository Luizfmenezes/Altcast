import { useState } from 'react'
import type { ReactNode } from 'react'
import { Reply } from 'lucide-react'
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
