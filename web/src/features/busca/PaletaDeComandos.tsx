import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { Hash, Lock, Search, Users, Volume2 } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Kbd } from '../../ui/Kbd.js'
import { cn } from '../../lib/utils.js'
import { usePerfilAberto } from '../presence/perfilAberto.js'

type Resultado =
  | { tipo: 'canal'; id: string; nome: string; contexto: string; voz: boolean; privado: boolean }
  | { tipo: 'grupo'; id: string; nome: string; contexto: string }
  | { tipo: 'membro'; id: string; nome: string; contexto: string; avatarUrl: string | null }

/** Ignora acento e caixa: procurar por "geral" tem de achar "Geral". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * A paleta de comandos.
 *
 * Busca so o que ja esta na memoria do cliente — grupos, canais e membros do
 * `ready`. Nao ha chamada de API nenhuma aqui, e por isso ela responde a cada
 * tecla sem rede no caminho.
 *
 * O teclado e o de combobox: o foco fica no campo, as setas movem o item ativo
 * e Enter abre. Antes nao havia item ativo nenhum — Enter nao fazia nada, e a
 * unica forma de escolher era tabular por doze botoes ou largar o teclado,
 * justamente numa ferramenta que existe para quem nao quer largar o teclado.
 */
export function PaletaDeComandos({ aberta, aoFechar }: {
  aberta: boolean
  aoFechar: () => void
}): ReactNode {
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const groups = useStore(e => e.groups)
  const channels = useStore(e => e.channels)
  const members = useStore(e => e.members)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const escolherCanal = useStore(e => e.escolherCanal)
  const abrirPerfil = usePerfilAberto(e => e.abrirPerfil)
  const idDaLista = useId()
  const lista = useRef<HTMLUListElement>(null)

  // A busca anterior nao sobrevive a reabertura: quem abre a paleta de novo
  // quase sempre procura outra coisa.
  useEffect(() => { if (aberta) { setBusca(''); setAtivo(0) } }, [aberta])

  const resultados = useMemo((): Resultado[] => {
    const alvo = normalizar(busca.trim())
    const nomeDoGrupo = (id: string): string => groups.find(g => g.id === id)?.name ?? ''

    /**
     * Uma pessoa, uma linha. `members` tem uma entrada por (grupo, pessoa), e
     * quem divide tres grupos comigo aparecia tres vezes seguidas — com o
     * mesmo nome e o mesmo avatar, diferindo so no contexto miudo a direita.
     */
    const porPessoa = new Map<string, { nome: string; avatarUrl: string | null; grupos: string[] }>()
    for (const m of members) {
      const atual = porPessoa.get(m.userId)
      if (atual === undefined) {
        porPessoa.set(m.userId, {
          nome: m.displayName, avatarUrl: m.avatarUrl, grupos: [nomeDoGrupo(m.groupId)],
        })
      } else {
        atual.grupos.push(nomeDoGrupo(m.groupId))
      }
    }

    const todos: Resultado[] = [
      ...channels.map((c): Resultado => ({
        tipo: 'canal', id: c.id, nome: c.name, contexto: nomeDoGrupo(c.groupId),
        voz: c.type === 'voice', privado: c.visibility === 'private',
      })),
      ...groups.map((g): Resultado => ({
        tipo: 'grupo', id: g.id, nome: g.name, contexto: 'Grupo',
      })),
      ...[...porPessoa].map(([userId, p]): Resultado => ({
        tipo: 'membro', id: userId, nome: p.nome, avatarUrl: p.avatarUrl,
        contexto: p.grupos.length === 1 ? p.grupos[0]! : `${String(p.grupos.length)} grupos`,
      })),
    ]

    if (alvo === '') return todos.slice(0, 8)
    // Comeca com o termo antes de contem o termo: quem digita "ge" quer
    // "geral" antes de "reuniao-de-gestao".
    const nome = (r: Resultado): string => normalizar(r.nome)
    return [
      ...todos.filter(r => nome(r).startsWith(alvo)),
      ...todos.filter(r => !nome(r).startsWith(alvo) && nome(r).includes(alvo)),
    ].slice(0, 12)
  }, [busca, channels, groups, members])

  const indiceAtivo = Math.min(ativo, Math.max(resultados.length - 1, 0))

  // O item ativo sempre a vista: com doze resultados numa caixa de 50vh, a
  // seta desceria para fora da area visivel sem esta rolagem.
  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${String(indiceAtivo)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [indiceAtivo])

  function abrir(resultado: Resultado): void {
    if (resultado.tipo === 'canal') {
      const canal = channels.find(c => c.id === resultado.id)
      if (canal) escolherGrupo(canal.groupId)
      escolherCanal(resultado.id)
    }
    if (resultado.tipo === 'grupo') escolherGrupo(resultado.id)
    if (resultado.tipo === 'membro') abrirPerfil(resultado.id)
    aoFechar()
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    if (resultados.length === 0) return
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault()
      const passo = evento.key === 'ArrowDown' ? 1 : -1
      setAtivo((indiceAtivo + passo + resultados.length) % resultados.length)
    }
    if (evento.key === 'Enter') {
      evento.preventDefault()
      abrir(resultados[indiceAtivo]!)
    }
  }

  const idDaOpcao = (i: number): string => `${idDaLista}-${String(i)}`

  return (
    <Dialogo.Root open={aberta} onOpenChange={a => { if (!a) aoFechar() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay
          className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm
                     data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <Dialogo.Content
          aria-label="Buscar"
          className={cn(
            `fixed left-1/2 top-[12vh] z-50 flex w-[min(36rem,calc(100%-2rem))]
             -translate-x-1/2 flex-col overflow-hidden rounded-xl border
             border-border-subtle bg-bg-raised shadow-dialog
             data-[state=open]:animate-in data-[state=open]:fade-in-0
             data-[state=open]:zoom-in-95`,
          )}
        >
          <Dialogo.Title className="sr-only">Buscar canais, grupos e pessoas</Dialogo.Title>
          <Dialogo.Description className="sr-only">
            Digite para filtrar. Use as setas para escolher, Enter para abrir e Escape para fechar.
          </Dialogo.Description>

          <div className="flex items-center gap-3 border-b border-border-subtle px-4">
            <Search aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-fg-muted" />
            <input
              autoFocus
              role="combobox"
              aria-expanded={resultados.length > 0}
              aria-controls={idDaLista}
              aria-autocomplete="list"
              aria-activedescendant={resultados.length > 0 ? idDaOpcao(indiceAtivo) : undefined}
              value={busca}
              onChange={e => { setBusca(e.target.value); setAtivo(0) }}
              onKeyDown={aoTeclar}
              placeholder="Buscar canais, grupos ou pessoas…"
              aria-label="Buscar canais, grupos ou pessoas"
              className="min-w-0 flex-1 bg-transparent py-4 text-[15px] text-fg outline-none
                         placeholder:text-fg-muted"
            />
            <Kbd>Esc</Kbd>
          </div>

          {resultados.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">
              Nada encontrado para “{busca.trim()}”.
            </p>
          ) : (
            <ul
              ref={lista}
              id={idDaLista}
              role="listbox"
              aria-label="Resultados"
              className="flex max-h-[50vh] list-none flex-col overflow-y-auto p-1.5"
            >
              {resultados.map((r, i) => (
                <li
                  key={`${r.tipo}-${r.id}`}
                  id={idDaOpcao(i)}
                  role="option"
                  aria-selected={i === indiceAtivo}
                  data-indice={i}
                  // `mousedown` so segura o foco no campo; quem abre e o clique.
                  onMouseDown={evento => { evento.preventDefault() }}
                  onClick={() => { abrir(r) }}
                  onMouseMove={() => { if (i !== indiceAtivo) setAtivo(i) }}
                  className={cn(
                    `flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm
                     text-fg-muted`,
                    i === indiceAtivo && 'bg-bg-hover text-fg',
                  )}
                >
                  {r.tipo === 'membro'
                    ? <Avatar nome={r.nome} url={r.avatarUrl} tamanho="sm" />
                    : r.tipo === 'grupo'
                      ? <Users aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
                      : r.voz
                        ? <Volume2 aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
                        : <Hash aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />}

                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{r.nome}</span>

                  {r.tipo === 'canal' && r.privado && (
                    <>
                      <Lock aria-hidden="true" strokeWidth={2} className="size-3 shrink-0" />
                      <span className="sr-only">canal privado</span>
                    </>
                  )}
                  <span className="shrink-0 truncate text-xs text-fg-muted">{r.contexto}</span>
                </li>
              ))}
            </ul>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
