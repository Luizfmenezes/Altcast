import { useState } from 'react'
import type { ReactNode } from 'react'
import { SmilePlus } from 'lucide-react'
import { api } from '../../lib/api.js'
import { cn } from '../../lib/utils.js'
import type { Reacao } from '../../lib/tipos.js'

/**
 * As reacoes de uma mensagem.
 *
 * Uma reacao e a resposta mais barata que existe numa conversa: concordar sem
 * escrever "concordo" e sem empurrar mais uma linha na tela de todo mundo. Num
 * canal movimentado, e a diferenca entre uma pergunta respondida e uma
 * pergunta soterrada por trinta "+1".
 *
 * Sao duas pecas desde a Mensagem v2. As PILULAS (quem reagiu com o que) moram
 * no corpo, porque sao conteudo. O SELETOR mora na barra de acoes flutuante,
 * porque e uma acao — e a acao sempre visivel, embaixo de toda mensagem, era o
 * cromo que pesava tanto quanto a conversa.
 */

/**
 * Os emoji que ficam a um clique.
 *
 * Um punhado, e nao o catalogo inteiro: a barra rapida existe para o caso
 * comum — concordar, comemorar, discordar —, e uma grade com mil opcoes
 * transformaria a acao mais barata da conversa na mais cara.
 */
export const FREQUENTES = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '🔥', '😢'] as const

/**
 * Reagir e desfazer pela mesma acao.
 *
 * Clicar no que ja esta marcado DESFAZ, e nao repete: a alternativa seria um
 * botao que so soma, deixando a pessoa sem caminho de volta do proprio
 * clique. E a mesma regra do palco e do mudo — quem escolheu pode desescolher.
 *
 * Sem `await`: o evento do WebSocket e quem atualiza a barra, e ele chega para
 * todo mundo pelo mesmo caminho. Mas nao esperar nao e ignorar: a falha vira
 * estado, e a reacao simplesmente nao aparece — o servidor nunca a registrou.
 */
export function useAlternarReacao(messageId: string, reacoes: Reacao[], eu: string | null): {
  alternar: (emoji: string) => void
  falhou: boolean
} {
  const [falhou, setFalhou] = useState(false)
  function alternar(emoji: string): void {
    setFalhou(false)
    const minha = reacoes.find(r => r.emoji === emoji)?.userIds.includes(eu ?? '') === true
    const pedido = minha
      ? api.delete(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
      : api.post(`/messages/${messageId}/reactions`, { emoji })
    pedido.catch(() => setFalhou(true))
  }
  return { alternar, falhou }
}

/** As pilulas: uma por emoji, com a contagem e o destaque do que e meu. */
export function Reacoes({ messageId, reacoes, eu }: {
  messageId: string
  reacoes: Reacao[]
  /** Quem esta olhando, para destacar as proprias reacoes. */
  eu: string | null
}): ReactNode {
  const { alternar, falhou } = useAlternarReacao(messageId, reacoes, eu)
  if (reacoes.length === 0 && !falhou) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reacoes.map(reacao => {
        const minha = reacao.userIds.includes(eu ?? '')
        return (
          <button
            key={reacao.emoji}
            type="button"
            onClick={() => { alternar(reacao.emoji) }}
            aria-pressed={minha}
            // A contagem entra no NOME acessivel, e nao so no texto visivel:
            // "2" sozinho, lido em voz alta, nao diz de que.
            aria-label={`${reacao.emoji}, ${String(reacao.userIds.length)} ${
              reacao.userIds.length === 1 ? 'pessoa' : 'pessoas'}${minha ? ', você reagiu' : ''}`}
            className={cn(
              'numerico inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs',
              minha
                ? 'border-accent bg-accent-subtle text-fg'
                : 'border-border-subtle text-fg-muted hover:border-border',
            )}
          >
            <span aria-hidden="true">{reacao.emoji}</span>
            <span aria-hidden="true">{reacao.userIds.length}</span>
          </button>
        )
      })}

      {/* `role="status"` e nao `alert`: a reacao que nao foi registrada merece
          ser dita, mas nao interrompe quem esta lendo a conversa. */}
      {falhou && (
        <p role="status" className="w-full text-xs text-danger">
          Não foi possível registrar a reação. Tente de novo.
        </p>
      )}
    </div>
  )
}

/**
 * O seletor de reacao, dentro da barra de acoes.
 *
 * O `Escape` fica no INVOLUCRO, e nao na caixa que abre: depois de clicar em
 * "Reagir", o foco esta no BOTAO — fora da caixa. Um ouvinte preso a caixa
 * nunca receberia a tecla.
 */
export function SeletorDeReacao({ messageId, reacoes, eu, aoAbrir }: {
  messageId: string
  reacoes: Reacao[]
  eu: string | null
  /** Avisa a barra de acoes para continuar visivel enquanto o seletor esta aberto. */
  aoAbrir?: (aberto: boolean) => void
}): ReactNode {
  const [aberto, setAbertoLocal] = useState(false)
  const { alternar } = useAlternarReacao(messageId, reacoes, eu)
  const setAberto = (valor: boolean): void => { setAbertoLocal(valor); aoAbrir?.(valor) }

  return (
    <div
      className="relative"
      onKeyDown={e => {
        if (e.key !== 'Escape' || !aberto) return
        e.stopPropagation()
        setAberto(false)
      }}
    >
      <button
        type="button"
        onClick={() => { setAberto(!aberto) }}
        aria-expanded={aberto}
        aria-label="Reagir a esta mensagem"
        title="Reagir"
        className="inline-flex size-8 items-center justify-center rounded text-fg-muted
                   hover:bg-bg-hover hover:text-fg focus-visible:bg-bg-hover"
      >
        <SmilePlus aria-hidden="true" className="size-4" />
      </button>

      {aberto && (
        <div
          role="group"
          aria-label="Escolher reação"
          className="absolute bottom-full right-0 z-20 mb-1 flex gap-0.5 rounded-lg border
                     border-border bg-bg-raised p-1 shadow-popover"
        >
          {FREQUENTES.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => { alternar(emoji); setAberto(false) }}
              aria-label={`Reagir com ${emoji}`}
              className="inline-flex size-8 items-center justify-center rounded text-base
                         hover:bg-bg-hover focus-visible:bg-bg-hover"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
