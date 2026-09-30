import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Hash, Lock, Mic, MicOff, MonitorUp, Volume2, BellOff } from 'lucide-react'
import { useStore, naoLidasDoCanal } from '../../lib/store.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import type { Canal, Membro } from '../../lib/tipos.js'
import { Badge } from '../../ui/Badge.js'
import { Avatar } from '../../ui/Avatar.js'
import { AnelDeFala } from '../../ui/bits/AnelDeFala.js'
import { Contador } from '../../ui/bits/Contador.js'
import { MenuDoGrupo } from '../groups/MenuDoGrupo.js'
import { MenuDeNotificacao } from '../presence/MenuDeNotificacao.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'
import { canalSilenciado } from '../../lib/atencao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { cn } from '../../lib/utils.js'

/** "Ninguem na sala", com identidade estavel — um `[]` novo por render faria o
 *  zustand concluir que mudou a cada quadro. Mesmo motivo do `NINGUEM` do
 *  painel de voz. */
const VAZIO: ParticipanteDeVoz[] = []
const NINGUEM_FALANDO: string[] = []

/**
 * Quem esta dentro do canal de voz, listado sob ele.
 *
 * Era a ausencia mais visivel em relacao ao Discord: o canal dizia "canal de
 * voz" e nada mais, entao decidir se valia a pena entrar exigia entrar. E o
 * dado ja estava todo aqui — `chamadas[canalId]` da os participantes e
 * `members` da nome e foto —, sem uma rota nova sequer.
 */
function RosterDeVoz({ participantes, membros, canal, falando }: {
  participantes: ParticipanteDeVoz[]
  membros: Membro[]
  canal: string
  /**
   * Quem fala agora. So existe para a sala em que EU estou: quem fala e um
   * dado do SFU, e o cliente so esta ligado ao SFU da propria chamada.
   */
  falando: string[]
}): ReactNode {
  if (participantes.length === 0) return null

  const nomeDe = (userId: string): string =>
    membros.find(m => m.userId === userId)?.displayName ?? 'Alguém'
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
            <AnelDeFala falando={falando.includes(p.userId)}>
              <Avatar nome={nome} url={fotoDe(p.userId)} tamanho="sm" className="size-5 text-[9px]" />
            </AnelDeFala>
            <span className="min-w-0 flex-1 truncate">{nome}</span>
            {/* O icone repete o que o rotulo da linha ja diz por extenso, entao
                e decorativo: anunciar duas vezes so atrapalha quem ouve. */}
            {p.microfone
              ? <Mic aria-hidden="true" className="size-3 shrink-0" />
              : <MicOff aria-hidden="true" className="size-3 shrink-0 text-danger" />}
            {p.tela ? <MonitorUp aria-hidden="true" className="size-3 shrink-0 text-accent" /> : null}
            <span className="sr-only">
              {falando.includes(p.userId) ? ', falando' : ''}
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
function ItemDeCanal({ canal, ativo, naoLidas, mencoes = 0, silenciado = false, naSala, aoEscolher }: {
  canal: Canal
  ativo: boolean
  naoLidas: number
  /** Quantas das nao lidas me mencionam. */
  mencoes?: number
  /** Silenciado pelo proprio canal ou pelo grupo: sem destaque, so mencao. */
  silenciado?: boolean
  /** Quantas pessoas ja estao na chamada. Sempre 0 em canal de texto. */
  naSala: number
  aoEscolher: () => void
}): ReactNode {
  const Icone = canal.type === 'voice' ? Volume2 : Hash
  // Negrito no canal com novidade, e nao so a pilula: contar com a cor sozinha
  // deixaria de fora quem nao a distingue (SC 1.4.1).
  //
  // Silenciado nao ganha negrito nem ponto: e exatamente o que a pessoa pediu
  // para parar de ver. A mencao, porem, continua — ela e sobre a pessoa, e o
  // numero dela e a unica coisa que o silencio nao apaga da lista.
  const destacado = naoLidas > 0 && !ativo && !silenciado

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
            ? 'font-semibold text-fg hover:bg-bg-hover'
            : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        silenciado && !ativo && 'opacity-60',
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
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-fg-muted">
          {/*
            O ponto "no ar": sala com gente e a unica coisa da lista que esta
            acontecendo AGORA. Pulsa devagar (2s) — o bastante para ser visto,
            devagar demais para competir com a leitura. Parado sob movimento
            reduzido.
          */}
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-accent-live motion-safe:animate-[pulse_2s_ease-in-out_infinite]"
          />
          <Contador para={naSala} />
          <span className="sr-only">
            {naSala === 1 ? ' pessoa na chamada' : ' pessoas na chamada'}
          </span>
        </span>
      ) : null}

      {silenciado && (
        <>
          <BellOff aria-hidden="true" strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
          <span className="sr-only">(silenciado)</span>
        </>
      )}

      {/*
        Mencao e numero; nao lida e so um ponto. O numero de nao lidas num canal
        movimentado ("47") nao muda decisao nenhuma — o que muda e "tem algo
        novo" e "alguem falou comigo", e sao exatamente esses dois sinais.
      */}
      {mencoes > 0 && !ativo ? (
        <>
          <Badge>{mencoes > 99 ? '99+' : mencoes}</Badge>
          <span className="sr-only">
            {mencoes === 1 ? '1 menção a você' : `${mencoes} menções a você`}
          </span>
        </>
      ) : destacado ? (
        <>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-fg" />
          <span className="sr-only">
            {naoLidas === 1 ? '1 mensagem não lida'
              : naoLidas >= 100 ? 'mais de 99 mensagens não lidas'
                : `${naoLidas} mensagens não lidas`}
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
        className={`flex items-center gap-1 rounded px-1 py-1 text-xs font-semibold
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
/**
 * Clicar num canal de voz ENTRA nele.
 *
 * Era o gesto mais desalinhado da interface: clicar abria um painel que dizia
 * "Entrar na chamada", e entrar exigia um segundo clique noutro canto da tela.
 * Em toda ferramenta parecida — e na expectativa de quem chega — o canal de voz
 * e a sala, e clicar nela e entrar.
 *
 * O unico caso que precisa de pergunta e trocar de sala estando dentro de
 * outra: ali o clique nao acrescenta nada, ele DERRUBA uma conversa em
 * andamento. Um clique errado na lista nao pode custar isso, e e a diferenca
 * entre um atalho e uma armadilha.
 *
 * Voltar a clicar no canal em que voce JA esta nao faz nada — nem reentra, nem
 * sai. Sair tem botao proprio, e transformar o mesmo gesto em entrar e sair
 * conforme o estado e como se perde a chamada sem entender por que.
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

  const canalEmChamada = useChamadaAtiva(e => e.canal)
  const falandoNaMinhaSala = useChamadaAtiva(e => e.chamada.falando)
  const entrarNaChamada = useChamadaAtiva(e => e.entrar)
  const sairDaChamada = useChamadaAtiva(e => e.sair)
  /** O canal que a pessoa clicou enquanto estava em outra chamada. Guardar o
   *  canal inteiro, e nao o id, e o que permite a pergunta citar os dois nomes
   *  — e "sair de #geral para entrar em #sala2?" e uma pergunta respondivel,
   *  enquanto "trocar de sala?" nao e. */
  const [trocarPara, setTrocarPara] = useState<Canal | null>(null)

  const doGrupo = useMemo(
    () => channels.filter(c => c.groupId === grupoAtivo),
    [channels, grupoAtivo],
  )
  const grupo = groups.find(g => g.id === grupoAtivo)
  const nomeDoCanalEmChamada = canalEmChamada === null
    ? null
    : channels.find(c => c.id === canalEmChamada)?.name ?? null

  const texto = doGrupo.filter(c => c.type === 'text')
  const voz = doGrupo.filter(c => c.type === 'voice')

  const naoLidasMap = useStore(e => e.naoLidas)
  const contagemDoServidor = useStore(e => e.contagemDoServidor)
  const preferencias = useStore(e => e.preferencias)
  const naoLidas = (canal: Canal): number =>
    naoLidasDoCanal({ mensagens, leituras, user, naoLidas: naoLidasMap, contagemDoServidor }, canal.id)

  const item = (canal: Canal): ReactNode => (
    <li key={canal.id}>
      <ItemDeCanal
        canal={canal}
        ativo={canal.id === canalAtivo}
        naoLidas={naoLidas(canal)}
        mencoes={naoLidasMap[canal.id]?.mentions ?? 0}
        silenciado={canalSilenciado({ preferencias }, canal)}
        naSala={(chamadas[canal.id] ?? VAZIO).length}
        aoEscolher={() => {
          escolherCanal(canal.id)
          aoEscolher?.()
          if (canal.type !== 'voice') return
          // Ja estou nesta sala: abrir o canal e so abrir o canal.
          if (canalEmChamada === canal.id) return
          // Em outra chamada: a confirmacao abre, e quem decide e a pessoa.
          if (canalEmChamada !== null) { setTrocarPara(canal); return }
          void entrarNaChamada(canal.id)
        }}
      />
      {canal.type === 'voice' ? (
        <RosterDeVoz
          participantes={chamadas[canal.id] ?? VAZIO}
          membros={members}
          canal={canal.name}
          falando={canal.id === canalEmChamada ? falandoNaMinhaSala : NINGUEM_FALANDO}
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
      {grupo === undefined ? null : (
        // O sino do grupo mora ao lado do nome, e nao dentro do menu: e o
        // ajuste que se faz de passagem, e um submenu dentro de outro menu
        // esconderia o gesto mais frequente atras de dois cliques.
        <div className="flex items-stretch border-b border-border-subtle">
          <div className="min-w-0 flex-1 [&>button]:border-b-0">
            <MenuDoGrupo grupo={grupo} variante="cabecalho" />
          </div>
          <div className="flex items-center pr-2">
            <MenuDeNotificacao scopeType="group" scopeId={grupo.id} groupId={grupo.id} />
          </div>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        style={{ padding: 'var(--space-row)' }}
      >
        {doGrupo.length === 0 && (
          <p className="px-2 py-3 text-xs text-fg-muted">
            Nenhum canal ainda. Crie o primeiro para começar a conversa.
          </p>
        )}

        <Secao titulo="Canais de texto" quantidade={texto.length}>
          {texto.map(item)}
        </Secao>
        <Secao titulo="Canais de voz" quantidade={voz.length}>
          {voz.map(item)}
        </Secao>
      </div>

      {/*
        Controlado, e sem gatilho proprio: quem abre e o clique na lista. Um
        gatilho visivel seria um segundo botao para a mesma acao, e e
        exatamente o excesso de botoes que esta fatia foi reduzir.
      */}
      <ConfirmarAcao
        aberto={trocarPara !== null}
        aoMudarAberto={aberto => { if (!aberto) setTrocarPara(null) }}
        titulo={`Trocar para ${trocarPara?.name ?? ''}?`}
        descricao={
          `Você está numa chamada em ${nomeDoCanalEmChamada ?? 'outro canal'} e vai sair dela `
          + 'para entrar nesta.'
        }
        confirmar="Trocar de sala"
        tom="padrao"
        aoConfirmar={() => {
          const destino = trocarPara
          setTrocarPara(null)
          if (destino === null) return
          // Sair antes de entrar, e nao em paralelo: duas sessoes de midia
          // vivas ao mesmo tempo disputariam o microfone, e o sintoma seria
          // um audio que some ao trocar de sala.
          sairDaChamada()
          void entrarNaChamada(destino.id)
        }}
      />
    </div>
  )
}
