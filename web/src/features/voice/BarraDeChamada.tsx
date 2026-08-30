import type { ReactNode } from 'react'
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { useChamadaAtiva } from './chamadaAtiva.js'

/**
 * A chamada em curso, visivel de qualquer tela.
 *
 * Esta barra nao e conveniencia: ela e a garantia que substitui a que se
 * perdeu. Antes, sair do canal derrubava a chamada, e isso — por acidente —
 * garantia que ninguem ficasse com o microfone aberto sem saber. Agora a
 * chamada sobrevive a navegacao, e o unico jeito honesto de manter aquela
 * protecao e mostrar o estado do microfone o TEMPO TODO, em toda tela, em vez
 * de depender de a pessoa estar olhando o canal certo.
 *
 * Por isso o icone do microfone e o primeiro item e nunca some: uma barra que
 * escondesse esse estado seria pior do que nao ter barra nenhuma.
 */
export function BarraDeChamada(): ReactNode {
  const canal = useChamadaAtiva(e => e.canal)
  const chamada = useChamadaAtiva(e => e.chamada)
  const alternarMicrofone = useChamadaAtiva(e => e.alternarMicrofone)
  const alternarSurdo = useChamadaAtiva(e => e.alternarSurdo)
  const sair = useChamadaAtiva(e => e.sair)

  const nome = useStore(e => e.channels.find(c => c.id === canal)?.name ?? null)
  const escolherCanal = useStore(e => e.escolherCanal)
  const canalAberto = useStore(e => e.canalAtivo)
  const members = useStore(e => e.members)

  if (canal === null) return null

  const falando = chamada.falando
    .map(id => members.find(m => m.userId === id)?.displayName)
    .filter((n): n is string => n !== undefined)

  return (
    <div
      aria-label="Chamada em curso"
      className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle
                 bg-bg-raised px-3 py-1"
    >
      {/*
        O estado do microfone, sempre. `aria-pressed` porque isto e um
        interruptor, e nao uma acao: quem usa leitor de tela precisa ouvir se
        esta ligado ANTES de decidir apertar.
      */}
      <button
        type="button"
        onClick={alternarMicrofone}
        aria-pressed={chamada.microfone}
        aria-label={chamada.microfone ? 'Microfone ligado' : 'Microfone desligado'}
        title={chamada.microfone ? 'Microfone ligado' : 'Microfone desligado'}
        className={`inline-flex size-8 items-center justify-center rounded hover:bg-bg-hover
                    focus-visible:bg-bg-hover ${
          chamada.microfone ? 'text-fg' : 'text-fg-muted'}`}
      >
        {chamada.microfone
          ? <Mic aria-hidden="true" className="size-4" />
          : <MicOff aria-hidden="true" className="size-4" />}
      </button>

      {/*
        Ensurdecer fica ao lado do microfone porque os dois respondem a mesma
        pergunta — "estou dentro ou fora desta conversa?" — e porque ensurdecer
        derruba o microfone junto: separa-los sugeriria que sao independentes.
      */}
      <button
        type="button"
        onClick={alternarSurdo}
        aria-pressed={chamada.surdo}
        aria-label={chamada.surdo ? 'Ensurdecido' : 'Ouvindo a sala'}
        title={chamada.surdo ? 'Ensurdecido' : 'Ouvindo a sala'}
        className={`inline-flex size-8 items-center justify-center rounded hover:bg-bg-hover
                    focus-visible:bg-bg-hover ${chamada.surdo ? 'text-danger' : 'text-fg'}`}
      >
        {chamada.surdo
          ? <HeadphoneOff aria-hidden="true" className="size-4" />
          : <Headphones aria-hidden="true" className="size-4" />}
      </button>

      {/*
        O nome do canal e um BOTAO, e nao um rotulo: depois de navegar para
        longe, voltar para a chamada e a coisa que mais se quer fazer a partir
        desta barra, e obrigar a procurar o canal na lista desfaria metade do
        ganho de a chamada ter sobrevivido a navegacao.
      */}
      <button
        type="button"
        onClick={() => { escolherCanal(canal) }}
        disabled={canalAberto === canal}
        className="truncate rounded px-2 text-sm text-fg hover:bg-bg-hover
                   focus-visible:bg-bg-hover disabled:cursor-default disabled:opacity-70"
      >
        {nome === null ? 'Na chamada' : `Na chamada — ${nome}`}
      </button>

      {/*
        Quem esta falando, em texto. Ele e o unico sinal da barra que responde
        "a sala ainda esta viva?" para quem esta em outra tela.
      */}
      {falando.length > 0 && (
        <span className="truncate text-xs text-fg-muted">
          {falando.join(', ')} falando
        </span>
      )}

      <button
        type="button"
        onClick={() => { void sair() }}
        className="ml-auto inline-flex items-center gap-1 rounded px-2 text-sm text-danger
                   hover:bg-bg-hover focus-visible:bg-bg-hover"
        style={{ minHeight: 'var(--height-row)' }}
      >
        <PhoneOff aria-hidden="true" className="size-4" />
        Sair da chamada
      </button>
    </div>
  )
}
