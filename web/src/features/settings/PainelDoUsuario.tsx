import type { ReactNode } from 'react'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Configuracoes } from './Configuracoes.js'

/**
 * Quem voce e, no rodape da coluna de canais.
 *
 * O avatar ja existia — solto num canto da barra do topo, do tamanho de uma
 * moeda, sem nome ao lado e sem nada para clicar. Isso responde "ha uma sessao
 * aberta" e nada mais. Numa conta com apelido e nome de usuario separados, e
 * num app onde a mesma pessoa entra de duas maquinas, a pergunta que a
 * interface precisa responder de relance e outra: *quem* esta logado aqui.
 *
 * A engrenagem MUDOU de lugar, e nao ganhou uma copia. Duas portas com o mesmo
 * nome acessivel quebrariam `getByRole('button', { name: 'Configuracoes' })` —
 * e, pior, ensinariam que existem duas telas de configuracao.
 */
export function PainelDoUsuario(): ReactNode {
  const user = useStore(e => e.user)
  const groups = useStore(e => e.groups)
  const grupoAtivo = useStore(e => e.grupoAtivo)

  if (!user) return null

  const grupoAtual = groups.find(g => g.id === grupoAtivo)
  /**
   * Comparacao de papel no cliente e decisao de APRESENTACAO, nunca de
   * autorizacao: esconder a aba poupa um caminho sem saida, e quem forcar a
   * rota mesmo assim recebe 404 da API.
   */
  const administra = grupoAtual?.role === 'owner' || grupoAtual?.role === 'admin'

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-border-subtle
                 bg-bg-raised px-2 py-1.5"
    >
      <Avatar nome={user.displayName} url={user.avatarUrl} tamanho="md" />

      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-medium text-fg">
          {user.displayName}
        </span>
        {/*
          O nome de usuario so aparece quando existe. Uma linha com `@undefined`
          — ou um espaco em branco reservado para ele — seria pior do que a
          ausencia: promete um identificador que a conta nao tem.
        */}
        {typeof user.username === 'string' && user.username.length > 0 ? (
          <span className="block truncate font-mono text-[11px] text-fg-muted">
            @{user.username}
          </span>
        ) : null}
      </span>

      <span className="sr-only">Voce esta como {user.displayName}</span>

      <Configuracoes groupId={grupoAtivo} podeAdministrar={administra} />
    </div>
  )
}
