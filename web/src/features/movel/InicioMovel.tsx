import type { ReactNode } from 'react'
import { ArrowRight, Hash, Plus, Radio, Search, Volume2 } from 'lucide-react'
import { ehConversa, useStore } from '../../lib/store.js'
import type { Canal, Grupo } from '../../lib/tipos.js'
import { canalSilenciado } from '../../lib/atencao.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { CriarGrupo } from '../groups/CriarGrupo.js'
import { Convites } from '../groups/Convites.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'
import { estaPresente } from '../presence/Presenca.js'
import { PASTEIS, TINTA, TINTA_SUAVE, pastelDe } from './cores.js'

/** "Bom dia" ate o meio-dia, "Boa tarde" ate as 18h, "Boa noite" depois. */
function saudacao(agora = new Date()): string {
  const h = agora.getHours()
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

type Pendencia = { canal: Canal; grupo: Grupo; n: number; mencoes: number }

/**
 * A casa do celular.
 *
 * Responde, nesta ordem, as tres perguntas de quem abre o app no bolso: o que
 * chegou (o cartao grande), onde (os grupos), e o que exatamente (a lista de
 * canais acesos). A chamada em curso toma o lugar do cartao grande, porque
 * microfone aberto e a unica coisa mais urgente do que mensagem nova.
 */
export function InicioMovel({ aoAbrirGrupo, aoAbrirCanal, aoBuscar }: {
  aoAbrirGrupo: (groupId: string) => void
  aoAbrirCanal: () => void
  aoBuscar: () => void
}): ReactNode {
  const user = useStore(e => e.user)
  const groups = useStore(e => e.groups)
  const channels = useStore(e => e.channels)
  const naoLidas = useStore(e => e.naoLidas)
  const preferencias = useStore(e => e.preferencias)
  const members = useStore(e => e.members)
  const chamadas = useStore(e => e.chamadas)
  const canalEmChamada = useChamadaAtiva(e => e.canal)

  const grupos = groups.filter(g => !ehConversa(g))
  const porId = new Map(grupos.map(g => [g.id, g]))

  const pendencias: Pendencia[] = channels.flatMap(c => {
    const grupo = porId.get(c.groupId)
    const n = naoLidas[c.id]?.n ?? 0
    const mencoes = naoLidas[c.id]?.mentions ?? 0
    // Silenciado so entra com mencao: mencao atravessa o silencio, o resto nao.
    if (grupo === undefined || n === 0 || (canalSilenciado({ preferencias }, c) && mencoes === 0)) return []
    return [{ canal: c, grupo, n, mencoes }]
  }).sort((a, b) => b.mencoes - a.mencoes || b.n - a.n)

  const totalNovas = pendencias.reduce((s, p) => s + p.n, 0)
  const totalMencoes = pendencias.reduce((s, p) => s + p.mencoes, 0)

  function abrir(canal: Canal): void {
    const e = useStore.getState()
    if (e.grupoAtivo !== canal.groupId) e.escolherGrupo(canal.groupId)
    e.escolherCanal(canal.id)
    aoAbrirCanal()
  }

  const salaAtual = canalEmChamada === null ? null : channels.find(c => c.id === canalEmChamada) ?? null

  return (
    <div className="flex flex-col gap-7 px-5 pb-8 pt-3">
      <header className="flex items-center gap-3">
        <Avatar nome={user?.displayName ?? 'Você'} url={user?.avatarUrl ?? null} tamanho="lg" />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-lg font-semibold text-fg">
            {saudacao()}, {user?.displayName.split(' ')[0] ?? 'você'}
          </h1>
          <p className="text-sm text-fg-muted">Bem-vindo ao Altcast</p>
        </div>
        <Convites />
        <Botao
          variante="discreto"
          tamanho="icone"
          className="size-11 rounded-2xl"
          onClick={aoBuscar}
        >
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar</span>
        </Botao>
      </header>

      {/*
        O cartao grande. Pastel com tinta escura nos dois temas: e o unico
        lugar da tela que pode gritar, e grita o que importa agora.
      */}
      <section
        aria-label={salaAtual !== null ? 'Chamada em curso' : 'Resumo do que chegou'}
        className="relative overflow-hidden rounded-[28px] p-5"
        style={{ background: PASTEIS[0], color: TINTA }}
      >
        <Marca />
        {salaAtual !== null ? (
          <div className="relative flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm font-medium" style={{ color: TINTA_SUAVE }}>
              <Radio aria-hidden="true" className="size-4" />
              Você está no ar
            </p>
            <p className="truncate text-[32px] font-semibold leading-none tracking-tight">
              {nomeDaSala(salaAtual, groups, members, user?.id ?? null)}
            </p>
            <p className="text-sm" style={{ color: TINTA_SUAVE }}>
              {(chamadas[salaAtual.id]?.length ?? 1)} na chamada
            </p>
            <BotaoEscuro onClick={() => abrir(salaAtual)}>Voltar à chamada</BotaoEscuro>
          </div>
        ) : (
          <div className="relative flex flex-col gap-4">
            <p className="text-sm font-medium" style={{ color: TINTA_SUAVE }}>Mensagens novas</p>
            <p className="numerico text-[56px] font-semibold leading-none tracking-tighter">
              {totalNovas > 999 ? '999+' : totalNovas}
            </p>
            <p className="text-sm" style={{ color: TINTA_SUAVE }}>
              {totalNovas === 0
                ? 'Tudo em dia. Nada esperando por você.'
                : `Em ${String(pendencias.length)} ${pendencias.length === 1 ? 'canal' : 'canais'}`
                  + (totalMencoes > 0 ? ` · ${String(totalMencoes)} ${totalMencoes === 1 ? 'menção' : 'menções'}` : '')}
            </p>
            {pendencias[0] !== undefined && (
              <BotaoEscuro onClick={() => abrir(pendencias[0]!.canal)}>Ver o que chegou</BotaoEscuro>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="titulo-grupos" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="titulo-grupos" className="text-xl font-semibold tracking-tight text-fg">Seus grupos</h2>
          <CriarGrupo
            gatilho={
              <button
                type="button"
                className="flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-fg
                           hover:bg-bg-hover disabled:opacity-40"
              >
                <Plus aria-hidden="true" className="size-4" />
                Novo grupo
              </button>
            }
          />
        </div>
        {/*
          Rolagem horizontal com encaixe: os cartoes sao o atalho, e a lista
          completa de canais de cada um esta a um toque. A margem negativa deixa
          o cartao seguinte espiar da borda — a pista de que ha mais.
        */}
        <ul className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {grupos.map(g => (
            <li key={g.id} className="snap-start">
              <CartaoDeGrupo
                grupo={g}
                novas={pendencias.filter(p => p.grupo.id === g.id).reduce((s, p) => s + p.n, 0)}
                online={members.filter(m => m.groupId === g.id && estaPresente(m.status)).length}
                total={members.filter(m => m.groupId === g.id).length}
                aoAbrir={() => aoAbrirGrupo(g.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="titulo-atividade" className="flex flex-col gap-3">
        <h2 id="titulo-atividade" className="text-xl font-semibold tracking-tight text-fg">Atividade</h2>
        {pendencias.length === 0 ? (
          <p className="rounded-[22px] bg-bg-raised px-5 py-6 text-center text-sm text-fg-muted">
            Nenhum canal com mensagem nova.
          </p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-[22px] bg-bg-raised">
            {pendencias.slice(0, 8).map(p => (
              <li key={p.canal.id} className="border-b border-border-subtle last:border-b-0">
                <button
                  type="button"
                  onClick={() => abrir(p.canal)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-bg-hover"
                >
                  <Avatar nome={p.grupo.name} url={p.grupo.iconUrl} tamanho="lg" quadrado className="rounded-xl" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="flex items-center gap-1 truncate text-[15px] font-semibold text-fg">
                      {p.canal.type === 'voice'
                        ? <Volume2 aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                        : <Hash aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />}
                      <span className="truncate">{p.canal.name}</span>
                    </span>
                    <span className="truncate text-[13px] text-fg-muted">{p.grupo.name}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="numerico rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-semibold text-accent">
                      +{p.n > 99 ? '99' : p.n}
                    </span>
                    {p.mencoes > 0 && <span className="text-xs font-medium text-fg">@ {p.mencoes}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** O nome da sala para o cartao: numa conversa, a pessoa; num grupo, o canal. */
function nomeDaSala(
  sala: Canal, groups: Grupo[], members: { groupId: string; userId: string; displayName: string }[], eu: string | null,
): string {
  const grupo = groups.find(g => g.id === sala.groupId)
  if (ehConversa(grupo)) {
    return members.find(m => m.groupId === sala.groupId && m.userId !== eu)?.displayName ?? 'Conversa'
  }
  return sala.name
}

/** O botao pilula escuro do cartao pastel — o "Add money" da referencia. */
function BotaoEscuro({ onClick, children }: { onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 items-center justify-center gap-2 rounded-full text-[15px] font-semibold
                 text-white transition-transform active:scale-[0.98]"
      style={{ background: TINTA }}
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-4" />
    </button>
  )
}

/**
 * A marca d'agua do cartao: o nome repetido, em diagonal, quase invisivel —
 * a textura do cartao de banco da referencia, sem imagem nenhuma.
 */
function Marca(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-10 -top-6 select-none whitespace-pre text-[44px]
                 font-black leading-[0.95] tracking-tighter opacity-[0.07]"
      style={{ transform: 'rotate(-12deg)' }}
    >
      {'ALTCAST.ALT\nCAST.ALTCAST\n.ALTCAST.AL\nTCAST.ALTCA'}
    </span>
  )
}

function CartaoDeGrupo({ grupo, novas, online, total, aoAbrir }: {
  grupo: Grupo
  novas: number
  online: number
  total: number
  aoAbrir: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`${grupo.name}${novas > 0 ? `, ${String(novas)} novas` : ''}`}
      className="relative flex h-44 w-40 flex-col justify-between overflow-hidden rounded-[24px] p-4 text-left
                 transition-transform active:scale-[0.97]"
      style={{ background: pastelDe(grupo.id), color: TINTA }}
    >
      <span className="flex items-start justify-between">
        <Avatar nome={grupo.name} url={grupo.iconUrl} tamanho="lg" quadrado className="rounded-xl ring-2 ring-white/60" />
        {novas > 0 && (
          <span className="numerico rounded-full bg-white px-2 py-0.5 text-xs font-semibold" style={{ color: TINTA }}>
            {novas > 99 ? '99+' : novas}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="line-clamp-2 text-base font-semibold leading-tight">{grupo.name}</span>
        <span className="text-xs font-medium" style={{ color: TINTA_SUAVE }}>
          {online > 0 ? `${String(online)} online · ` : ''}{total} {total === 1 ? 'membro' : 'membros'}
        </span>
      </span>
    </button>
  )
}
