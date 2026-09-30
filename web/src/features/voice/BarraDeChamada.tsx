import type { ReactNode } from 'react'
import {
  AudioWaveform, Headphones, HeadphoneOff, Loader2, Mic, MicOff, PhoneOff, RotateCw, WifiOff,
} from 'lucide-react'
import { modeloDaSupressao } from '../../lib/midia.js'
import { useStore } from '../../lib/store.js'
import { cn } from '../../lib/utils.js'
import { Avatar } from '../../ui/Avatar.js'
import { AnelDeFala } from '../../ui/bits/AnelDeFala.js'
import { useChamadaAtiva } from './chamadaAtiva.js'
import { rotuloDaSituacao, situacaoDaChamada } from './situacao.js'

const BOTAO_DE_ICONE = `inline-flex size-8 items-center justify-center rounded hover:bg-bg-hover
                        focus-visible:bg-bg-hover`

/**
 * A chamada em curso, visivel de qualquer tela.
 *
 * Esta barra nao e conveniencia: ela e a garantia que substitui a que se
 * perdeu. Antes, sair do canal derrubava a chamada, e isso — por acidente —
 * garantia que ninguem ficasse com o microfone aberto sem saber. Agora a
 * chamada sobrevive a navegacao, e o unico jeito honesto de manter aquela
 * protecao e mostrar o estado do microfone o TEMPO TODO, em toda tela.
 *
 * O que ela diz sobre a conexao vem de `situacaoDaChamada`, a mesma funcao que
 * o painel de voz le. Ela dizia "Na chamada" so porque havia um canal
 * escolhido — inclusive quando a entrada tinha falhado e o painel, ao lado,
 * dizia "Fora da chamada".
 */
export function BarraDeChamada(): ReactNode {
  const canal = useChamadaAtiva(e => e.canal)
  const chamada = useChamadaAtiva(e => e.chamada)
  const alternarMicrofone = useChamadaAtiva(e => e.alternarMicrofone)
  const alternarSurdo = useChamadaAtiva(e => e.alternarSurdo)
  const tentarDeNovo = useChamadaAtiva(e => e.tentarDeNovo)
  const sair = useChamadaAtiva(e => e.sair)
  const definirSupressao = useChamadaAtiva(e => e.definirSupressao)

  const nome = useStore(e => e.channels.find(c => c.id === canal)?.name ?? null)
  const escolherCanal = useStore(e => e.escolherCanal)
  const canalAberto = useStore(e => e.canalAtivo)
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user)
  const naSala = useStore(e => (canal === null ? undefined : e.chamadas[canal]))

  if (canal === null) return null

  const situacao = situacaoDaChamada(canal, chamada)
  const conectada = situacao === 'conectado' || situacao === 'reconectando'
  const comIa = modeloDaSupressao(chamada.supressao) !== null

  /** Um membro por pessoa: a mesma pessoa aparece uma vez por grupo em comum. */
  const pessoaDe = (userId: string): { nome: string; avatarUrl: string | null } => {
    const m = members.find(x => x.userId === userId)
    if (m !== undefined) return { nome: m.displayName, avatarUrl: m.avatarUrl }
    if (eu !== null && eu.id === userId) return { nome: eu.displayName, avatarUrl: eu.avatarUrl ?? null }
    return { nome: 'Alguém', avatarUrl: null }
  }
  const participantes = naSala ?? []

  return (
    <div
      role="region"
      aria-label="Chamada em curso"
      className="flex shrink-0 flex-col gap-1 border-t border-border-subtle bg-bg-raised px-2 py-1.5"
    >
      <div className="flex items-center gap-1">
        {/*
          O estado da conexao, com forma e texto — nunca so cor. O nome do
          canal e um BOTAO: voltar para a chamada e a coisa que mais se quer
          fazer a partir desta barra.
        */}
        <button
          type="button"
          onClick={() => { escolherCanal(canal) }}
          disabled={canalAberto === canal}
          className={cn(
            `flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm
             hover:bg-bg-hover focus-visible:bg-bg-hover disabled:cursor-default`,
            situacao === 'falhou' ? 'text-danger' : 'text-fg',
          )}
        >
          <IconeDaSituacao situacao={situacao} />
          <span className="min-w-0 truncate font-medium">
            {rotuloDaSituacao(situacao, nome)}
          </span>
        </button>

        {conectada && (
          <>
            {/*
              O estado do microfone, sempre que ha sala. `aria-pressed` porque
              isto e um interruptor: quem usa leitor de tela precisa ouvir se
              esta ligado ANTES de decidir apertar.
            */}
            <button
              type="button"
              onClick={alternarMicrofone}
              aria-pressed={chamada.microfone}
              aria-label={chamada.microfone ? 'Microfone ligado' : 'Microfone desligado'}
              title={chamada.microfone ? 'Microfone ligado' : 'Microfone desligado'}
              className={cn(BOTAO_DE_ICONE, chamada.microfone ? 'text-fg' : 'text-fg-muted')}
            >
              {chamada.microfone
                ? <Mic aria-hidden="true" className="size-4" />
                : <MicOff aria-hidden="true" className="size-4" />}
            </button>

            {/*
              A supressao de ruido por IA, a um clique — o botao do "Krisp".
              Liga no modo IA e desliga para o filtro do navegador; os outros
              modos moram nas configuracoes de voz.
            */}
            <button
              type="button"
              onClick={() => { definirSupressao(comIa ? 'navegador' : 'ia') }}
              aria-pressed={comIa}
              aria-label={comIa ? 'Supressão de ruído por IA ligada' : 'Supressão de ruído por IA desligada'}
              title={comIa
                ? chamada.supressaoAtiva ? 'Supressão de ruído por IA: ligada' : 'Supressão de ruído por IA: aguardando o microfone'
                : 'Supressão de ruído por IA: desligada'}
              className={cn(BOTAO_DE_ICONE, comIa ? 'text-speaking' : 'text-fg-muted')}
            >
              <AudioWaveform aria-hidden="true" className="size-4" />
            </button>

            {/*
              Ensurdecer fica ao lado do microfone porque os dois respondem a
              mesma pergunta — "estou dentro ou fora desta conversa?".
            */}
            <button
              type="button"
              onClick={alternarSurdo}
              aria-pressed={chamada.surdo}
              aria-label={chamada.surdo ? 'Ensurdecido' : 'Ouvindo a sala'}
              title={chamada.surdo ? 'Ensurdecido' : 'Ouvindo a sala'}
              className={cn(BOTAO_DE_ICONE, chamada.surdo ? 'text-danger' : 'text-fg')}
            >
              {chamada.surdo
                ? <HeadphoneOff aria-hidden="true" className="size-4" />
                : <Headphones aria-hidden="true" className="size-4" />}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => { void sair() }}
          aria-label="Sair da chamada"
          title="Sair da chamada"
          className={cn(BOTAO_DE_ICONE, 'text-danger')}
        >
          <PhoneOff aria-hidden="true" className="size-4" />
        </button>
      </div>

      {situacao === 'falhou' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-1.5 pb-0.5">
          <p className="min-w-0 flex-1 text-xs text-fg-muted">
            {chamada.erro ?? 'Não foi possível conectar.'}
          </p>
          <button
            type="button"
            onClick={() => { void tentarDeNovo() }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium
                       text-fg hover:bg-bg-hover"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            Tentar de novo
          </button>
        </div>
      )}

      {/*
        Quem esta na sala, pelas fotos — e quem fala acende em verde. E o
        sinal da barra que responde "a sala ainda esta viva?" para quem esta em
        outra tela, sem um texto piscando a cada silaba.
      */}
      {situacao === 'conectado' && participantes.length > 0 && (
        <ul aria-label="Pessoas na chamada" className="flex flex-wrap items-center gap-2 px-1.5 pb-0.5 pt-1">
          {participantes.map(p => {
            const pessoa = pessoaDe(p.userId)
            const fala = chamada.falando.includes(p.userId)
            return (
              <li key={p.userId} title={fala ? `${pessoa.nome} (falando)` : pessoa.nome}>
                <AnelDeFala
                  falando={fala}
                  nivel={p.userId === eu?.id ? chamada.nivel * 4 : 1}
                >
                  <Avatar nome={pessoa.nome} url={pessoa.avatarUrl} tamanho="sm" />
                </AnelDeFala>
                <span className="sr-only">{fala ? `${pessoa.nome}, falando` : pessoa.nome}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function IconeDaSituacao({ situacao }: { situacao: ReturnType<typeof situacaoDaChamada> }): ReactNode {
  if (situacao === 'conectando') {
    return <Loader2 aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
  }
  if (situacao === 'reconectando') {
    return <Loader2 aria-hidden="true" className="size-4 shrink-0 text-warning motion-safe:animate-spin" />
  }
  if (situacao === 'falhou') return <WifiOff aria-hidden="true" className="size-4 shrink-0" />
  // O ponto "no ar": a unica cor viva da barra, e o que a identidade da
  // Etapa 1 transforma no acento de transmissao.
  return <span aria-hidden="true" className="ml-1 mr-0.5 size-2 shrink-0 rounded-full bg-accent-live" />
}
