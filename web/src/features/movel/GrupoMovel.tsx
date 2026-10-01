import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Hash, Lock, Volume2 } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import type { Canal } from '../../lib/tipos.js'
import { canalSilenciado } from '../../lib/atencao.js'
import { Avatar } from '../../ui/Avatar.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { MenuDoGrupo } from '../groups/MenuDoGrupo.js'
import { MenuDeNotificacao } from '../presence/MenuDeNotificacao.js'
import { estaPresente } from '../presence/Presenca.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'
import { cn } from '../../lib/utils.js'
import { TINTA, TINTA_SUAVE, pastelDe } from './cores.js'

const NINGUEM: ParticipanteDeVoz[] = []

/**
 * Um grupo no celular: quem e, e os canais em linhas grandes.
 *
 * Tocar num canal de voz ENTRA na chamada, como na lista do desktop — com a
 * mesma pergunta quando ja se esta em outra sala. A regra e uma so nos dois
 * tamanhos de tela; so o desenho muda.
 */
export function GrupoMovel({ aoVoltar, aoAbrirCanal }: {
  aoVoltar: () => void
  aoAbrirCanal: () => void
}): ReactNode {
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const grupo = useStore(e => e.groups.find(g => g.id === e.grupoAtivo))
  const channels = useStore(e => e.channels)
  const naoLidas = useStore(e => e.naoLidas)
  const preferencias = useStore(e => e.preferencias)
  const members = useStore(e => e.members)
  const chamadas = useStore(e => e.chamadas)
  const escolherCanal = useStore(e => e.escolherCanal)

  const canalEmChamada = useChamadaAtiva(e => e.canal)
  const entrar = useChamadaAtiva(e => e.entrar)
  const sair = useChamadaAtiva(e => e.sair)
  const [trocarPara, setTrocarPara] = useState<Canal | null>(null)

  if (grupo === undefined || grupoAtivo === null) return null

  const doGrupo = channels.filter(c => c.groupId === grupoAtivo)
  const membros = members.filter(m => m.groupId === grupoAtivo)
  const online = membros.filter(m => estaPresente(m.status))

  function tocar(canal: Canal): void {
    escolherCanal(canal.id)
    aoAbrirCanal()
    if (canal.type !== 'voice' || canalEmChamada === canal.id) return
    if (canalEmChamada !== null) { setTrocarPara(canal); return }
    void entrar(canal.id)
  }

  const linha = (canal: Canal): ReactNode => {
    const n = naoLidas[canal.id]?.n ?? 0
    const mencoes = naoLidas[canal.id]?.mentions ?? 0
    const calado = canalSilenciado({ preferencias }, canal)
    const sala = chamadas[canal.id] ?? NINGUEM
    const Icone = canal.type === 'voice' ? Volume2 : Hash
    return (
      <li key={canal.id}>
        <button
          type="button"
          onClick={() => tocar(canal)}
          className={cn(
            'flex w-full items-center gap-3 rounded-[20px] bg-bg-raised px-4 py-3.5 text-left',
            'transition-transform active:scale-[0.99]',
            calado && 'opacity-60',
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-hover text-fg">
            <Icone aria-hidden="true" className="size-[18px]" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className={cn('flex items-center gap-1.5 truncate text-[15px] text-fg', n > 0 && !calado ? 'font-semibold' : 'font-medium')}>
              <span className="truncate">{canal.name}</span>
              {canal.visibility === 'private' && <Lock aria-label="privado" className="size-3.5 shrink-0 text-fg-muted" />}
            </span>
            {canal.type === 'voice' ? (
              <span className="mt-1 flex items-center gap-1.5 text-[13px] text-fg-muted">
                {sala.length === 0 ? 'Ninguém na sala' : (
                  <>
                    <span className="flex -space-x-1.5">
                      {sala.slice(0, 4).map(p => {
                        const m = membros.find(x => x.userId === p.userId)
                        return (
                          <Avatar key={p.userId} nome={m?.displayName ?? 'Alguém'} url={m?.avatarUrl ?? null}
                            tamanho="sm" className="ring-2 ring-bg-raised" />
                        )
                      })}
                    </span>
                    {sala.length} na sala
                  </>
                )}
              </span>
            ) : canal.topic !== null && canal.topic !== '' ? (
              <span className="mt-0.5 truncate text-[13px] text-fg-muted">{canal.topic}</span>
            ) : null}
          </span>
          {mencoes > 0 ? (
            <span className="numerico rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-danger-fg">
              @{mencoes}
            </span>
          ) : n > 0 && !calado ? (
            <span className="numerico rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-semibold text-accent">
              {n > 99 ? '99+' : n}
            </span>
          ) : null}
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        </button>
      </li>
    )
  }

  const texto = doGrupo.filter(c => c.type === 'text')
  const voz = doGrupo.filter(c => c.type === 'voice')

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-3">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2">
        <button
          type="button"
          onClick={aoVoltar}
          className="flex size-11 items-center justify-center rounded-2xl border border-border-subtle bg-bg-raised text-fg"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
          <span className="sr-only">Voltar</span>
        </button>
        <h1 className="truncate text-center text-[17px] font-semibold text-fg">{grupo.name}</h1>
        <span className="flex justify-end">
          <MenuDeNotificacao scopeType="group" scopeId={grupo.id} groupId={grupo.id} />
        </span>
      </header>

      <section
        className="flex items-center gap-4 rounded-[28px] p-5"
        style={{ background: pastelDe(grupo.id), color: TINTA }}
      >
        <Avatar nome={grupo.name} url={grupo.iconUrl} tamanho="xl" quadrado className="rounded-2xl ring-4 ring-white/60" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold leading-tight">{grupo.name}</p>
          <p className="mt-1 text-sm" style={{ color: TINTA_SUAVE }}>
            {online.length} online · {membros.length} {membros.length === 1 ? 'membro' : 'membros'}
          </p>
          {online.length > 0 && (
            <span className="mt-2 flex -space-x-2">
              {online.slice(0, 6).map(m => (
                <Avatar key={m.userId} nome={m.displayName} url={m.avatarUrl} tamanho="sm" className="ring-2 ring-white/70" />
              ))}
            </span>
          )}
        </div>
      </section>

      {/* O menu do grupo — convidar, membros, configuracoes, sair — numa porta grande. */}
      <div className="overflow-hidden rounded-[20px] border border-border-subtle bg-bg-raised [&_button]:border-b-0 [&_button]:py-3.5">
        <MenuDoGrupo grupo={grupo} variante="cabecalho" />
      </div>

      {texto.length > 0 && (
        <section aria-labelledby="movel-texto" className="flex flex-col gap-2">
          <h2 id="movel-texto" className="px-1 text-sm font-semibold text-fg-muted">Canais de texto</h2>
          <ul className="flex flex-col gap-2">{texto.map(linha)}</ul>
        </section>
      )}
      {voz.length > 0 && (
        <section aria-labelledby="movel-voz" className="flex flex-col gap-2">
          <h2 id="movel-voz" className="px-1 text-sm font-semibold text-fg-muted">Canais de voz</h2>
          <ul className="flex flex-col gap-2">{voz.map(linha)}</ul>
        </section>
      )}
      {doGrupo.length === 0 && (
        <p className="rounded-[20px] bg-bg-raised px-5 py-6 text-center text-sm text-fg-muted">
          Nenhum canal ainda.
        </p>
      )}

      <ConfirmarAcao
        aberto={trocarPara !== null}
        aoMudarAberto={a => { if (!a) setTrocarPara(null) }}
        titulo={`Trocar para ${trocarPara?.name ?? ''}?`}
        descricao="Você está em outra chamada e vai sair dela para entrar nesta."
        confirmar="Trocar de sala"
        tom="padrao"
        aoConfirmar={() => {
          const destino = trocarPara
          setTrocarPara(null)
          if (destino === null) return
          void sair().then(() => entrar(destino.id))
        }}
      />
    </div>
  )
}
