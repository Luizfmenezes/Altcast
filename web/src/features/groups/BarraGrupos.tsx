import type { ReactNode } from 'react'
import { useStore, naoLidasDoCanal } from '../../lib/store.js'
import { Configuracoes } from '../settings/Configuracoes.js'
import { Avatar } from '../../ui/Avatar.js'
import { Dica } from '../../ui/Tooltip.js'
import { Separador } from '../../ui/Separador.js'
import { CriarGrupo } from './CriarGrupo.js'
import { cn } from '../../lib/utils.js'

/**
 * Coluna de 64px, largura fixa. Nao muda de largura com nome longo nem com
 * hover: dimensao estavel e requisito, e nao detalhe - a barra lateral que
 * pula ao passar o mouse obriga a reencontrar o alvo a cada movimento.
 */
export function BarraGrupos(): ReactNode {
  const groups = useStore(e => e.groups)
  const channels = useStore(e => e.channels)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const mensagens = useStore(e => e.mensagens)
  const leituras = useStore(e => e.leituras)
  const user = useStore(e => e.user)
  const grupoAtual = groups.find(g => g.id === grupoAtivo)
  /**
   * Comparacao de papel no cliente e decisao de APRESENTACAO, nunca de
   * autorizacao: esconder a aba poupa um caminho sem saida, e quem forcar a
   * rota mesmo assim recebe 404 da API. A autorizacao continua inteira em
   * can.ts, do outro lado.
   */
  const administra = grupoAtual?.role === 'owner' || grupoAtual?.role === 'admin'

  const temNovidade = (groupId: string): boolean => channels
    .filter(c => c.groupId === groupId)
    .some(c => naoLidasDoCanal({ mensagens, leituras, user }, c.id) > 0)

  return (
    <nav
      aria-label="Grupos"
      className="flex shrink-0 flex-col items-center gap-1.5 border-r border-border-subtle
                 bg-bg-raised py-3"
      style={{ width: 'var(--w-groups)' }}
    >
      {groups.map(grupo => {
        const ativo = grupo.id === grupoAtivo
        const novidade = !ativo && temNovidade(grupo.id)
        return (
          <Dica key={grupo.id} texto={grupo.name} lado="right">
            <button
              type="button"
              onClick={() => escolherGrupo(grupo.id)}
              aria-current={ativo ? 'true' : undefined}
              // O id nao aparece em texto nenhum da interface; os fluxos ponta a
              // ponta precisam enderecar o grupo sem inventar um endpoint so
              // para o teste.
              data-grupo={grupo.id}
              className="group/grupo relative flex size-12 items-center justify-center"
            >
              {/* A pilula a esquerda e a leitura de relance: alta no grupo
                  aberto, curta onde ha novidade, ausente no resto. Ela nunca e
                  a unica pista — o aria-current e o texto do sr-only dizem a
                  mesma coisa para quem nao ve a coluna. */}
              <span
                aria-hidden="true"
                className={cn(
                  `absolute left-0 w-1 rounded-r-full bg-fg transition-all duration-200 ease-out`,
                  ativo ? 'h-6' : novidade ? 'h-2' : 'h-0',
                )}
              />
              <Avatar
                nome={grupo.name}
                url={grupo.iconUrl}
                tamanho="lg"
                quadrado
                className={cn(
                  'transition-[border-radius,box-shadow] duration-200 ease-out',
                  ativo
                    ? 'rounded-[14px] ring-2 ring-accent ring-offset-2 ring-offset-bg-raised'
                    : 'group-hover/grupo:rounded-[14px]',
                )}
              />
              <span className="sr-only">
                {grupo.name}
                {novidade ? ' (mensagens nao lidas)' : ''}
              </span>
            </button>
          </Dica>
        )
      })}

      {/* Empurrado para o rodape da coluna: o que se usa o dia inteiro fica em
          cima, e o que se abre de vez em quando fica fora do caminho. */}
      <CriarGrupo />

      <div className="mt-auto flex flex-col items-center gap-2">
        <Separador className="w-8" />
        <Configuracoes
          groupId={grupoAtivo}
          podeAdministrar={administra}
        />
      </div>
    </nav>
  )
}
