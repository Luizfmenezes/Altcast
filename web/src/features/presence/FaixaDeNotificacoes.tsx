import type { ReactNode } from 'react'
import { BellRing, X } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import {
  ativarNotificacoes, recusarNotificacoes, usePedidoDeNotificacao,
} from '../../lib/notificacoes.js'

/**
 * A oferta de notificacoes do sistema, no momento em que ela faz sentido.
 *
 * Aparece logo depois da primeira mencao — quando a pessoa acabou de ver, na
 * pratica, o que perderia sem o aviso. A permissao so e pedida no clique de
 * "Ativar", que e o gesto que o navegador exige; "Agora nao" e lembrado, e a
 * faixa nao volta a insistir.
 */
export function FaixaDeNotificacoes(): ReactNode {
  const oferecer = usePedidoDeNotificacao(e => e.oferecer)
  if (!oferecer) return null

  return (
    <div
      role="region"
      aria-label="Notificações"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle
                 bg-bg-raised px-3 py-2 text-sm"
    >
      <BellRing aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-fg">
        Alguém mencionou você.{' '}
        <span className="text-fg-muted">Quer um aviso do sistema da próxima vez, mesmo com a aba em segundo plano?</span>
      </p>
      <Botao tamanho="sm" onClick={() => { void ativarNotificacoes() }}>Ativar avisos</Botao>
      <Botao variante="fantasma" tamanho="sm" onClick={recusarNotificacoes}>Agora não</Botao>
      <Botao variante="fantasma" tamanho="iconeSm" onClick={recusarNotificacoes}>
        <X aria-hidden="true" />
        <span className="sr-only">Fechar</span>
      </Botao>
    </div>
  )
}
