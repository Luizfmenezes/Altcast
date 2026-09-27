import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useStore, naoLidasDoCanal } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Dica } from '../../ui/Tooltip.js'
import { Separador } from '../../ui/Separador.js'
import { CriarGrupo } from './CriarGrupo.js'
import { Convites } from './Convites.js'
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

  const temNovidade = (groupId: string): boolean => channels
    .filter(c => c.groupId === groupId)
    .some(c => naoLidasDoCanal({ mensagens, leituras, user }, c.id) > 0)

  return (
    <nav
      aria-label="Grupos"
      // `overflow-y-auto`: com doze grupos a coluna passava da altura da
      // janela, e os ultimos — mais o botao de criar grupo — ficavam
      // recortados sem barra de rolagem nenhuma.
      className="flex shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r
                 border-border-subtle bg-bg-raised py-3"
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
              {/*
                A pilula a esquerda e a leitura de relance: alta no grupo
                aberto, curta onde ha novidade, ausente no resto. Ela nunca e a
                unica pista — o `aria-current` e o texto do `sr-only` dizem a
                mesma coisa para quem nao ve a coluna.

                A do grupo ABERTO desliza de um grupo para o outro, em
                vez de sumir aqui e reaparecer ali. `layoutId` e o unico jeito
                honesto de fazer isso: a `motion` mede as duas posicoes e
                interpola, e nenhuma delas precisa saber da outra.

                E vale a pena porque e a unica coisa nesta coluna que diz onde
                voce esta: vista sumir e aparecer, a troca de grupo parece um
                recarregamento; vista deslizar, parece movimento.

                A de NOVIDADE continua sendo um `<span>` comum — ela pode
                existir em varios grupos ao mesmo tempo, e `layoutId` exige
                unicidade. O `MotionConfig` da raiz desliga a animacao inteira
                para quem pediu menos movimento.
              */}
              {ativo ? (
                <motion.span
                  layoutId="pilula-do-grupo-ativo"
                  aria-hidden="true"
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  className="absolute left-0 h-6 w-1 rounded-r-full bg-fg"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-0 w-1 rounded-r-full bg-fg transition-all duration-200 ease-out',
                    novidade ? 'h-2' : 'h-0',
                  )}
                />
              )}
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
                {novidade ? ' (mensagens não lidas)' : ''}
              </span>
            </button>
          </Dica>
        )
      })}

      {/* Empurrado para o rodape da coluna: o que se usa o dia inteiro fica em
          cima, e o que se abre de vez em quando fica fora do caminho. */}
      <CriarGrupo />

      {/*
        A engrenagem saiu daqui e foi para o painel do usuario, no rodape da
        coluna de canais. Configuracao e um assunto da PESSOA — perfil, conta,
        audio, aparencia —, e morava na coluna dos GRUPOS; o que e do grupo
        agora tem porta propria, no cabecalho do grupo. Sobrou nesta coluna
        exatamente o que pertence a ela.
      */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <Separador className="w-8" />
        {/* Um convite pendente e a unica coisa nesta coluna que pede resposta,
            e aparece so quando existe. */}
        <Convites />
      </div>
    </nav>
  )
}
