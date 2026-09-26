import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Hash, Lock, Mic, MicOff, MonitorUp, Volume2 } from 'lucide-react'
import { useStore, naoLidasDoCanal } from '../../lib/store.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import type { Canal, Membro } from '../../lib/tipos.js'
import { Badge } from '../../ui/Badge.js'
import { Avatar } from '../../ui/Avatar.js'
import { Contador } from '../../ui/bits/Contador.js'
import { MenuDoGrupo } from '../groups/MenuDoGrupo.js'
import { cn } from '../../lib/utils.js'

/** "Ninguem na sala", com identidade estavel — um `[]` novo por render faria o
 *  zustand concluir que mudou a cada quadro. Mesmo motivo do `NINGUEM` do
 *  painel de voz. */
const VAZIO: ParticipanteDeVoz[] = []

/**
 * Quem esta dentro do canal de voz, listado sob ele.
 *
 * Era a ausencia mais visivel em relacao ao Discord: o canal dizia "canal de
 * voz" e nada mais, entao decidir se valia a pena entrar exigia entrar. E o
 * dado ja estava todo aqui — `chamadas[canalId]` da os participantes e
 * `members` da nome e foto —, sem uma rota nova sequer.
 */
function RosterDeVoz({ participantes, membros, canal }: {
  participantes: ParticipanteDeVoz[]
  membros: Membro[]
  canal: string
}): ReactNode {
  if (participantes.length === 0) return null

  const nomeDe = (userId: string): string =>
    membros.find(m => m.userId === userId)?.displayName ?? 'Alguem'
  const fotoDe = (userId: string): string | null =>
    membros.find(m => m.userId === userId)?.avatarUrl ?? null

  return (
    <ul aria-label={`Na chamada de ${canal}`} className="flex flex-col gap-0.5 pb-0.5 pl-6">
      {participantes.map(p => {
        const nome = nomeDe(p.userId)
        return (
          <li
            key={p.userId}
            className="flex items-center gap-2 rounded px-2 py-1 text-[12px] text-fg-muted"
          >
            <Avatar nome={nome} url={fotoDe(p.userId)} tamanho="sm" className="size-5 text-[9px]" />
            <span className="min-w-0 flex-1 truncate">{nome}</span>
            {/* O icone repete o que o rotulo da linha ja diz por extenso, entao
                e decorativo: anunciar duas vezes so atrapalha quem ouve. */}
            {p.microfone
              ? <Mic aria-hidden="true" className="size-3 shrink-0" />
              : <MicOff aria-hidden="true" className="size-3 shrink-0 text-danger" />}
            {p.tela ? <MonitorUp aria-hidden="true" className="size-3 shrink-0 text-accent" /> : null}
            <span className="sr-only">
              {p.microfone ? ', microfone ligado' : ', microfone desligado'}
              {p.tela ? ', transmitindo a tela' : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Um item da lista de canais.
 *
 * Era `role="tab"` dentro de um `tablist`, e deixou de ser. Um `tablist` exige
 * que seus filhos sejam `tab`, e as secoes colapsaveis colocam entre eles um
 * cabecalho focavel que nao e — `aria-required-children` reprova, com razao.
 *
 * A troca corrige uma semantica que ja estava torta: `tab` promete um
 * `tabpanel` correspondente, e a conversa nunca foi um. Isto aqui e navegacao,
 * e navegacao se anuncia com `aria-current`. O Alt com seta nao dependia dos
 * papeis: ele vive no AppShell e anda pela store.
 */
function ItemDeCanal({ canal, ativo, naoLidas, naSala, aoEscolher }: {
  canal: Canal
  ativo: boolean
  naoLidas: number
  /** Quantas pessoas ja estao na chamada. Sempre 0 em canal de texto. */
  naSala: number
  aoEscolher: () => void
}): ReactNode {
  const Icone = canal.type === 'voice' ? Volume2 : Hash
  // Negrito no canal com novidade, e nao so a pilula: contar com a cor sozinha
  // deixaria de fora quem nao a distingue (SC 1.4.1).
  const destacado = naoLidas > 0 && !ativo

  return (
    <button
      type="button"
      aria-current={ativo ? 'true' : undefined}
      onClick={aoEscolher}
      className={cn(
        `group/canal flex w-full items-center gap-2 rounded-md px-2 text-left text-[13px]
         transition-colors duration-150`,
        ativo
          ? 'bg-bg-hover font-medium text-accent'
          : destacado
            ? 'font-medium text-fg hover:bg-bg-hover'
            : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
      )}
      style={{ minHeight: 'var(--height-row)' }}
    >
      <span className="relative flex shrink-0 items-center">
        <Icone
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn('size-4', ativo ? 'text-accent' : 'text-fg-muted/80')}
        />
        {canal.visibility === 'private' && (
          // Cadeado so aparece em canal que chegou ate aqui, isto e, um do qual
          // a pessoa ja participa. Canal privado alheio nunca chega, e por isso
          // nao existe ramo para "sem acesso": inventa-lo contaria a existencia
          // que a spec 03 secao 9 manda nao contar.
          <Lock
            aria-hidden="true"
            strokeWidth={2.5}
            className="absolute -bottom-0.5 -right-1 size-2.5 text-fg-muted"
          />
        )}
      </span>

      <span className="min-w-0 flex-1 truncate">{canal.name}</span>
      {canal.visibility === 'private' && <span className="sr-only">(canal privado)</span>}

      {/*
        A sala cheia se anuncia mesmo com o canal aberto — ao contrario das nao
        lidas, que somem quando voce ja esta lendo. Saber que ha gente
        conversando e o que faz alguem entrar, e essa informacao nao caduca por
        voce estar olhando para ela.
      */}
      {naSala > 0 ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
          <Contador para={naSala} />
          <span className="sr-only">
            {naSala === 1 ? ' pessoa na chamada' : ' pessoas na chamada'}
          </span>
        </span>
      ) : null}

      {naoLidas > 0 && !ativo ? (
        <>
          <Badge>{naoLidas > 99 ? '99+' : naoLidas}</Badge>
          <span className="sr-only">
            {naoLidas === 1 ? '1 mensagem nao lida' : `${naoLidas} mensagens nao lidas`}
          </span>
        </>
      ) : null}
    </button>
  )
}

function Secao({ titulo, quantidade, children }: {
  titulo: string
  quantidade: number
  children: ReactNode
}): ReactNode {
  const [aberta, setAberta] = useState(true)
  const idTitulo = titulo.replace(/\s+/g, '-').toLowerCase()
  if (quantidade === 0) return null

  return (
    <div className="flex flex-col">
      <button
        type="button"
        id={idTitulo}
        onClick={() => setAberta(a => !a)}
        aria-expanded={aberta}
        className={`flex items-center gap-1 rounded px-1 py-1 text-[11px] font-semibold
                    uppercase tracking-wider text-fg-muted transition-colors
                    hover:text-fg`}
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.5}
          className={cn('size-3 transition-transform duration-200', aberta && 'rotate-90')}
        />
        {titulo}
      </button>

      {/* A altura anima de 0fr para 1fr sem que ninguem precise medir nada em
          JS. Fechada, a secao some da arvore: manter os botoes navegaveis por
          teclado dentro de uma caixa de altura zero seria esconder so dos olhos. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          aberta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          {aberta && (
            <ul aria-labelledby={idTitulo} className="flex list-none flex-col gap-0.5 pb-1 pt-0.5">
              {children}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Os canais chegam ja filtrados pela visibilidade. A interface renderiza o que
 * recebeu e nada mais: nao existe ramo para "canal ao qual voce nao tem
 * acesso", porque esse canal nao chegou - e inventar um cadeado aqui contaria
 * justamente o que a spec 03 secao 9 manda nao contar.
 */
export function ListaCanais({ aoEscolher }: { aoEscolher?: () => void }): ReactNode {
  const channels = useStore(e => e.channels)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const canalAtivo = useStore(e => e.canalAtivo)
  const groups = useStore(e => e.groups)
  const escolherCanal = useStore(e => e.escolherCanal)
  const mensagens = useStore(e => e.mensagens)
  const leituras = useStore(e => e.leituras)
  const user = useStore(e => e.user)
  const chamadas = useStore(e => e.chamadas)
  const members = useStore(e => e.members)

  const doGrupo = useMemo(
    () => channels.filter(c => c.groupId === grupoAtivo),
    [channels, grupoAtivo],
  )
  const grupo = groups.find(g => g.id === grupoAtivo)

  const texto = doGrupo.filter(c => c.type === 'text')
  const voz = doGrupo.filter(c => c.type === 'voice')

  const naoLidas = (canal: Canal): number =>
    naoLidasDoCanal({ mensagens, leituras, user }, canal.id)

  const item = (canal: Canal): ReactNode => (
    <li key={canal.id}>
      <ItemDeCanal
        canal={canal}
        ativo={canal.id === canalAtivo}
        naoLidas={naoLidas(canal)}
        naSala={(chamadas[canal.id] ?? VAZIO).length}
        aoEscolher={() => {
          escolherCanal(canal.id)
          aoEscolher?.()
        }}
      />
      {canal.type === 'voice' ? (
        <RosterDeVoz
          participantes={chamadas[canal.id] ?? VAZIO}
          membros={members}
          canal={canal.name}
        />
      ) : null}
    </li>
  )

  return (
    <div className="flex h-full flex-col">
      {/*
        O cabecalho do grupo E o menu do grupo.

        Ele ja mostrava nome e papel, e ja ocupava a largura inteira da coluna —
        so nao fazia nada. Convidar alguem, ver a lista de membros e gerenciar
        canais moravam a dois cliques dali, atras de uma engrenagem no rodape.
        Transformar o que a pessoa ja olha no lugar onde ela ja procura custa
        zero componente novo.
      */}
      {grupo === undefined ? null : <MenuDoGrupo grupo={grupo} variante="cabecalho" />}

      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        style={{ padding: 'var(--space-row)' }}
      >
        {doGrupo.length === 0 && (
          <p className="px-2 py-3 text-xs text-fg-muted">
            Nenhum canal ainda. Crie o primeiro para comecar a conversa.
          </p>
        )}

        <Secao titulo="Canais de texto" quantidade={texto.length}>
          {texto.map(item)}
        </Secao>
        <Secao titulo="Canais de voz" quantidade={voz.length}>
          {voz.map(item)}
        </Secao>
      </div>
    </div>
  )
}
