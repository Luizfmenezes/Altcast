import { useState } from 'react'
import type { ReactNode } from 'react'
import { Hash, Link2, Settings2, ShieldCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore, possoNoGrupo } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { cn } from '../../lib/utils.js'
import { GestaoDeCanais } from './GestaoDeCanais.js'
import { IdentidadeDoGrupo } from './IdentidadeDoGrupo.js'
import { Cargos } from './Cargos.js'
import { Convidar } from '../groups/Convidar.js'
import { Membros } from '../groups/Membros.js'

/**
 * Configuracoes do grupo: um menu a esquerda, um assunto por vez a direita.
 *
 * Antes eram tres secoes empilhadas num scroll unico — canais, convites e
 * membros —, o que funcionava exatamente enquanto fossem tres. Com identidade
 * e cargos entrando viram cinco, e cargos sozinho precisa de duas colunas: a
 * lista de cargos e o editor de permissoes lado a lado. Empilhar isso no mesmo
 * rolo transformaria "trocar a foto do grupo" numa cacada.
 *
 * O menu tambem resolve um problema que o scroll escondia: ele NOMEIA o que
 * existe. Quem nunca tinha achado a tela de convites agora ve a palavra
 * "Convites" sem precisar rolar ate ela.
 *
 * ## Por que o menu some o que a pessoa nao pode
 *
 * Cada secao declara a permissao que a torna util, e some quando ela falta.
 * Isso e APRESENTACAO, nunca autorizacao: quem contornar a tela leva 404 de
 * `can.ts` do outro lado. A escolha e diferente da que a lista de canais faz —
 * la, esconder canal privado e regra de sigilo; aqui, mostrar uma aba que so
 * responde erro seria oferecer um caminho sem saida.
 *
 * "Membros" nunca some: ver quem esta no grupo e direito de quem pertence a
 * ele, e e a secao que responde a pergunta mais comum de todas.
 */

type Secao = {
  id: string
  rotulo: string
  descricao: string
  icone: LucideIcon
  /** A permissao que torna a secao util. Ausente: vale para todo membro. */
  exige?: string
  conteudo: (groupId: string) => ReactNode
}

const SECOES: Secao[] = [
  {
    id: 'geral',
    rotulo: 'Visão geral',
    descricao: 'Nome, imagem e exclusão do grupo.',
    icone: Settings2,
    exige: 'group.update',
    conteudo: groupId => <IdentidadeDoGrupo groupId={groupId} />,
  },
  {
    id: 'cargos',
    rotulo: 'Cargos',
    descricao: 'Cores, hierarquia e o que cada cargo permite.',
    icone: ShieldCheck,
    exige: 'group.manage_roles',
    conteudo: groupId => <Cargos groupId={groupId} />,
  },
  {
    id: 'canais',
    rotulo: 'Canais',
    descricao: 'Criar, renomear, reordenar e apagar.',
    icone: Hash,
    exige: 'channel.create',
    conteudo: groupId => <GestaoDeCanais groupId={groupId} />,
  },
  {
    id: 'convites',
    rotulo: 'Convites',
    descricao: 'Convidar alguém, ou gerar um link.',
    icone: Link2,
    exige: 'group.invite',
    conteudo: groupId => <Convidar groupId={groupId} />,
  },
  {
    id: 'membros',
    rotulo: 'Membros',
    descricao: 'Quem está no grupo e com quais cargos.',
    icone: Users,
    conteudo: groupId => <Membros groupId={groupId} />,
  },
]

/**
 * As permissoes que abrem alguma secao ALEM de "Membros".
 *
 * E o criterio unico de "administra este grupo" para o resto da interface. O
 * painel do usuario decidia pelo PAPEL (`owner` ou `admin`) enquanto esta tela
 * decidia pela PERMISSAO — um cargo com `group.invite` via a secao de
 * convites aqui dentro, mas nunca achava a aba "Grupo" para chegar nela.
 */
export const PERMISSOES_DE_ADMINISTRACAO: readonly string[] = SECOES
  .flatMap(s => s.exige === undefined ? [] : [s.exige])

export function ConfiguracoesGrupo({ groupId }: { groupId: string }): ReactNode {
  const grupo = useStore(e => e.groups.find(g => g.id === groupId))
  // Fatias nomeadas, e nao `e => e`: assinar a store inteira faria esta tela
  // re-renderizar a cada mensagem que chega em qualquer canal, com um dialogo
  // aberto por cima da conversa. `possoNoGrupo` precisa de quatro campos, e
  // sao exatamente estes quatro.
  const cargos = useStore(e => e.cargos)
  const cargosDoMembro = useStore(e => e.cargosDoMembro)
  const groups = useStore(e => e.groups)
  const user = useStore(e => e.user)

  const visiveis = SECOES.filter(s => s.exige === undefined
    || possoNoGrupo({ cargos, cargosDoMembro, groups, user }, groupId, s.exige))
  const [aberta, setAberta] = useState(visiveis[0]?.id ?? 'membros')
  // A secao escolhida pode desaparecer sob os pes: perder um cargo enquanto a
  // tela esta aberta e um acontecimento normal, e um painel vazio seria pior
  // do que voltar para a primeira que sobrou.
  const secao = visiveis.find(s => s.id === aberta) ?? visiveis[0]

  if (grupo === undefined || secao === undefined) return null

  return (
    <div className="flex min-h-0 flex-col gap-4 sm:flex-row">
      {/*
        `sm:` e nao `md:`: numa janela estreita as duas colunas viram uma so, e
        o menu passa a ser uma fita horizontal rolavel em vez de sumir atras de
        um botao. Esconder a navegacao e o que mais custa em tela pequena.
      */}
      <nav
        aria-label="Seções das configurações"
        className="flex shrink-0 gap-1 overflow-x-auto border-border-subtle pb-1
                   sm:w-52 sm:flex-col sm:overflow-visible sm:border-r sm:pb-0 sm:pr-3"
      >
        <div className="mb-2 hidden items-center gap-2 px-2 sm:flex">
          <Avatar nome={grupo.name} url={grupo.iconUrl} tamanho="sm" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
            {grupo.name}
          </span>
        </div>

        {visiveis.map(s => {
          const Icone = s.icone
          const ativa = s.id === secao.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setAberta(s.id)}
              aria-current={ativa ? 'page' : undefined}
              className={cn(
                `flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px]
                 transition-colors sm:w-full`,
                ativa
                  ? 'bg-bg-hover font-medium text-fg'
                  : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
              )}
            >
              <Icone
                aria-hidden="true"
                strokeWidth={1.75}
                className={cn('size-4 shrink-0', ativa ? 'text-accent' : 'text-fg-muted/80')}
              />
              {s.rotulo}
            </button>
          )
        })}
      </nav>

      {/*
        O painel rola sozinho, e o menu fica parado. Com o scroll unico de
        antes, rolar ate os membros levava embora a unica pista de onde a
        pessoa estava.
      */}
      <div className="min-w-0 flex-1 overflow-y-auto sm:max-h-[70vh] sm:pl-1">
        <header className="mb-4">
          <h2 className="text-[15px] font-semibold text-fg">{secao.rotulo}</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">{secao.descricao}</p>
        </header>
        {secao.conteudo(groupId)}
      </div>
    </div>
  )
}
