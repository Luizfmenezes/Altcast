import { useState } from 'react'
import type { ReactNode } from 'react'
import { SmilePlus } from 'lucide-react'
import { api } from '../../lib/api.js'
import type { Reacao } from '../../lib/tipos.js'

/**
 * A barra de reacoes de uma mensagem.
 *
 * Uma reacao e a resposta mais barata que existe numa conversa: concordar sem
 * escrever "concordo" e sem empurrar mais uma linha na tela de todo mundo. Num
 * canal movimentado, e a diferenca entre uma pergunta respondida e uma
 * pergunta soterrada por trinta "+1".
 */

/**
 * Os emoji que ficam a um clique.
 *
 * Um punhado, e nao o catalogo inteiro: a barra rapida existe para o caso
 * comum — concordar, comemorar, discordar —, e uma grade com mil opcoes
 * transformaria a acao mais barata da conversa na mais cara.
 */
const FREQUENTES = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '🔥', '😢'] as const

export function Reacoes({ messageId, reacoes, eu }: {
  messageId: string
  reacoes: Reacao[]
  /** Quem esta olhando, para destacar as proprias reacoes. */
  eu: string | null
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [falhou, setFalhou] = useState(false)

  /**
   * Reagir e desfazer pela mesma acao.
   *
   * Clicar no que ja esta marcado DESFAZ, e nao repete: a alternativa seria um
   * botao que so soma, deixando a pessoa sem caminho de volta do proprio
   * clique. E a mesma regra do palco e do mudo — quem escolheu pode desescolher.
   */
  function alternar(emoji: string): void {
    setFalhou(false)
    const minha = reacoes.find(r => r.emoji === emoji)?.userIds.includes(eu ?? '') === true
    setAberto(false)
    // Sem `await`: o evento do WebSocket e quem atualiza a barra, e ele chega
    // para todo mundo pelo mesmo caminho — inclusive para as outras abas de
    // quem clicou. Esperar aqui so atrasaria o que ja vai acontecer.
    //
    // Nao esperar, porem, nao e o mesmo que ignorar: um `void` sobre uma
    // promessa que rejeita vira rejeicao nao tratada, que suja o console de
    // quem usa e derruba a suite de teste inteira. O `catch` existe para
    // capturar, e nao para esconder — quando a chamada falha, a reacao
    // simplesmente nao aparece, e essa ausencia e o retorno honesto: o
    // servidor nunca a registrou, e fingir o contrario na tela seria mentir
    // sobre o que as outras pessoas estao vendo.
    const pedido = minha
      ? api.delete(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
      : api.post(`/messages/${messageId}/reactions`, { emoji })

    pedido.catch(() => setFalhou(true))
  }

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
              reacao.userIds.length === 1 ? 'pessoa' : 'pessoas'}${minha ? ', voce reagiu' : ''}`}
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs ${
              minha
                ? 'border-accent bg-accent/10 text-fg'
                : 'border-border-subtle text-fg-muted hover:border-border'}`}
          >
            <span aria-hidden="true">{reacao.emoji}</span>
            <span aria-hidden="true">{reacao.userIds.length}</span>
          </button>
        )
      })}

      {/*
        O `Escape` fica no INVOLUCRO, e nao na caixa que abre.

        Depois de clicar em "Reagir", o foco esta no BOTAO — fora da caixa. Um
        ouvinte preso a caixa nunca receberia a tecla, e a unica saida restante
        seria clicar fora, que e um gesto que nao existe para quem navega por
        teclado. Aqui ele funciona nas duas posicoes do foco.
      */}
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
          onClick={() => { setAberto(a => !a) }}
          aria-expanded={aberto}
          aria-label="Reagir a esta mensagem"
          title="Reagir"
          className="inline-flex size-7 items-center justify-center rounded-full
                     text-fg-muted hover:bg-bg-hover focus-visible:bg-bg-hover"
        >
          <SmilePlus aria-hidden="true" className="size-4" />
        </button>

        {aberto && (
          <div
            role="group"
            aria-label="Escolher reacao"
            className="absolute bottom-8 left-0 z-10 flex gap-1 rounded border border-border
                       bg-bg-raised p-1 shadow-lg"
          >
            {FREQUENTES.map(emoji => (
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
          </div>
        )}
      </div>

      {/* `role="status"` e nao `alert`: a reacao que nao foi registrada merece
          ser dita, mas nao interrompe quem esta lendo a conversa. */}
      {falhou && (
        <p role="status" className="w-full text-xs text-danger">
          Nao foi possivel registrar a reacao. Tente de novo.
        </p>
      )}
    </div>
  )
}
