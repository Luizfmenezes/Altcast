import { useState } from 'react'
import type { ReactNode } from 'react'
import { MessageCirclePlus, X } from 'lucide-react'
import {
  canalDeTexto, conversasVisiveis, outroDaConversa, useStore,
} from '../../lib/store.js'
import { fecharConversa } from '../../lib/conversas.js'
import type { Grupo } from '../../lib/tipos.js'
import { Avatar } from '../../ui/Avatar.js'
import { Badge } from '../../ui/Badge.js'
import { Botao } from '../../ui/Botao.js'
import { Dica } from '../../ui/Tooltip.js'
import { cn } from '../../lib/utils.js'
import { Presenca, ROTULO_DE_PRESENCA } from '../presence/Presenca.js'
import { NovaConversa } from './NovaConversa.js'

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const DIA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })

/** "14:32" se foi hoje, "3 de out." se nao. */
function quando(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? HORA.format(d) : DIA.format(d)
}

/**
 * As conversas diretas, da mais recente para a mais antiga.
 *
 * Duas apresentacoes da mesma lista: `coluna` mora no lugar da lista de
 * canais no desktop, e `movel` e a aba "Conversas" do celular — linhas mais
 * altas, avatar maior, a previa da ultima mensagem com folga para o polegar.
 */
export function ListaConversas({ variante = 'coluna', aoEscolher }: {
  variante?: 'coluna' | 'movel'
  aoEscolher?: () => void
}): ReactNode {
  const groups = useStore(e => e.groups)
  const channels = useStore(e => e.channels)
  const mensagens = useStore(e => e.mensagens)
  const leituras = useStore(e => e.leituras)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const area = useStore(e => e.area)
  const [nova, setNova] = useState(false)

  const lista = conversasVisiveis({ groups, channels, mensagens, leituras })
  const movel = variante === 'movel'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'flex shrink-0 items-center justify-between',
          movel ? 'px-5 pb-3 pt-2' : 'h-12 border-b border-border-subtle pl-4 pr-2',
        )}
      >
        <h2 className={cn('font-semibold text-fg', movel ? 'text-[26px] tracking-tight' : 'text-sm')}>
          Conversas
        </h2>
        {movel ? (
          <Botao variante="primario" tamanho="md" className="rounded-full" onClick={() => setNova(true)}>
            <MessageCirclePlus aria-hidden="true" />
            Nova
          </Botao>
        ) : (
          <Dica texto="Nova conversa" lado="bottom">
            <Botao variante="fantasma" tamanho="iconeSm" onClick={() => setNova(true)}>
              <MessageCirclePlus aria-hidden="true" strokeWidth={1.75} />
              <span className="sr-only">Nova conversa</span>
            </Botao>
          </Dica>
        )}
      </div>

      <ul
        className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', movel ? 'gap-2 px-4 pb-4' : 'gap-0.5 p-2')}
        aria-label="Conversas diretas"
      >
        {lista.length === 0 && (
          <li className={cn('flex flex-col items-center gap-3 text-center', movel ? 'px-6 py-16' : 'px-3 py-8')}>
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-subtle text-accent">
              <MessageCirclePlus aria-hidden="true" className="size-6" />
            </span>
            <p className="text-sm text-fg-muted">
              Nenhuma conversa ainda. Fale direto com alguém dos seus grupos — texto, arquivos e chamada.
            </p>
            <Botao variante="discreto" className="rounded-full" onClick={() => setNova(true)}>
              Começar uma conversa
            </Botao>
          </li>
        )}
        {lista.map(g => (
          <LinhaDeConversa
            key={g.id}
            grupo={g}
            ativa={area === 'conversas' && g.id === grupoAtivo}
            movel={movel}
            {...(aoEscolher === undefined ? {} : { aoEscolher })}
          />
        ))}
      </ul>

      <NovaConversa aberta={nova} aoMudar={setNova} />
    </div>
  )
}

function LinhaDeConversa({ grupo, ativa, movel, aoEscolher }: {
  grupo: Grupo
  ativa: boolean
  movel: boolean
  aoEscolher?: () => void
}): ReactNode {
  const outro = useStore(e => outroDaConversa(e, grupo.id))
  const canal = useStore(e => canalDeTexto(e.channels, grupo.id))
  const ultima = useStore(e => (canal === null ? undefined : e.mensagens[canal.id]?.at(-1)))
  const eu = useStore(e => e.user?.id ?? null)
  const naoLidas = useStore(e => (canal === null ? 0 : e.naoLidas[canal.id]?.n ?? 0))
  const escolherGrupo = useStore(e => e.escolherGrupo)

  const nome = outro?.displayName ?? 'Conta removida'
  const status = outro?.status ?? 'offline'
  const previa = ultima === undefined
    ? ROTULO_DE_PRESENCA[status]
    : `${ultima.authorId === eu ? 'Você: ' : ''}${ultima.content === '' ? 'Enviou um arquivo' : ultima.content}`

  return (
    <li className="group/conversa relative">
      <button
        type="button"
        onClick={() => { escolherGrupo(grupo.id); aoEscolher?.() }}
        aria-current={ativa ? 'true' : undefined}
        aria-label={`${nome}${naoLidas > 0 ? `, ${String(naoLidas)} não lidas` : ''}`}
        className={cn(
          'flex w-full items-center text-left transition-colors',
          movel
            ? 'gap-3 rounded-[22px] bg-bg-raised px-3 py-3 active:scale-[0.99]'
            : 'gap-2.5 rounded-md px-2 py-1.5 pr-8',
          ativa ? 'bg-bg-hover text-fg' : 'hover:bg-bg-hover',
        )}
      >
        <span className="relative flex shrink-0">
          <Avatar nome={nome} url={outro?.avatarUrl ?? null} tamanho={movel ? 'lg' : 'md'} />
          <Presenca status={status} modo="cracha" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-fg', movel ? 'text-[15px] font-semibold' : 'text-sm', naoLidas > 0 && 'font-semibold')}>
              {nome}
            </span>
            {movel && ultima !== undefined && (
              <span className="numerico shrink-0 text-xs text-fg-muted">{quando(ultima.createdAt)}</span>
            )}
          </span>
          <span className={cn('truncate', movel ? 'mt-0.5 text-[13px]' : 'text-xs', naoLidas > 0 ? 'text-fg' : 'text-fg-muted')}>
            {previa}
          </span>
        </span>
        {naoLidas > 0 && <Badge>{naoLidas > 99 ? '99+' : naoLidas}</Badge>}
      </button>
      {!movel && (
        <Dica texto="Fechar conversa" lado="right">
          <button
            type="button"
            onClick={() => { void fecharConversa(grupo.id) }}
            className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center
                       rounded text-fg-muted opacity-0 transition-opacity hover:bg-bg-raised hover:text-fg
                       focus-visible:opacity-100 group-hover/conversa:opacity-100"
          >
            <X aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Fechar conversa com {nome}</span>
          </button>
        </Dica>
      )}
    </li>
  )
}
