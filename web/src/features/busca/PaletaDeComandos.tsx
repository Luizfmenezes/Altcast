import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { Hash, Lock, Search, Users, Volume2 } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Kbd } from '../../ui/Kbd.js'
import { cn } from '../../lib/utils.js'

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
 * tecla sem rede no caminho. Mensagem nao entra: buscar texto de mensagem exige
 * indice no servidor, e fingir que a busca cobre o historico quando ela so
 * alcanca o que foi carregado seria pior do que nao oferecer.
 */
export function PaletaDeComandos({ aberta, aoFechar }: {
  aberta: boolean
  aoFechar: () => void
}): ReactNode {
  const [busca, setBusca] = useState('')
  const groups = useStore(e => e.groups)
  const channels = useStore(e => e.channels)
  const members = useStore(e => e.members)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const escolherCanal = useStore(e => e.escolherCanal)

  // A busca anterior nao sobrevive a reabertura: quem abre a paleta de novo
  // quase sempre procura outra coisa.
  useEffect(() => { if (aberta) setBusca('') }, [aberta])

  const resultados = useMemo((): Resultado[] => {
    const alvo = normalizar(busca.trim())
    const nomeDoGrupo = (id: string): string => groups.find(g => g.id === id)?.name ?? ''

    const todos: Resultado[] = [
      ...channels.map((c): Resultado => ({
        tipo: 'canal', id: c.id, nome: c.name, contexto: nomeDoGrupo(c.groupId),
        voz: c.type === 'voice', privado: c.visibility === 'private',
      })),
      ...groups.map((g): Resultado => ({
        tipo: 'grupo', id: g.id, nome: g.name, contexto: 'Grupo',
      })),
      ...members.map((m): Resultado => ({
        tipo: 'membro', id: m.userId, nome: m.displayName,
        contexto: nomeDoGrupo(m.groupId), avatarUrl: m.avatarUrl,
      })),
    ]

    if (alvo === '') return todos.slice(0, 8)
    return todos.filter(r => normalizar(r.nome).includes(alvo)).slice(0, 12)
  }, [busca, channels, groups, members])

  function abrir(resultado: Resultado): void {
    if (resultado.tipo === 'canal') {
      const canal = channels.find(c => c.id === resultado.id)
      if (canal) escolherGrupo(canal.groupId)
      escolherCanal(resultado.id)
    }
    if (resultado.tipo === 'grupo') escolherGrupo(resultado.id)
    // Membro ainda nao tem para onde levar: nao existe perfil nem conversa
    // direta. Ele aparece porque encontrar a pessoa ja e util, e some do
    // caminho sem prometer uma tela que nao existe.
    aoFechar()
  }

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
            `fixed left-1/2 top-[12vh] z-50 flex w-[min(36rem,calc(100vw-2rem))]
             -translate-x-1/2 flex-col overflow-hidden rounded-xl border
             border-border-subtle bg-bg-raised
             shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]
             data-[state=open]:animate-in data-[state=open]:fade-in-0
             data-[state=open]:zoom-in-95`,
          )}
        >
          <Dialogo.Title className="sr-only">Buscar canais, grupos e pessoas</Dialogo.Title>
          <Dialogo.Description className="sr-only">
            Digite para filtrar. Use Enter para abrir e Escape para fechar.
          </Dialogo.Description>

          <div className="flex items-center gap-3 border-b border-border-subtle px-4">
            <Search aria-hidden="true" strokeWidth={1.75} className="size-[18px] shrink-0 text-fg-muted" />
            <input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar canais, grupos ou pessoas..."
              aria-label="Buscar canais, grupos ou pessoas"
              className="min-w-0 flex-1 bg-transparent py-4 text-[15px] text-fg outline-none
                         placeholder:text-fg-muted"
            />
            <Kbd>Esc</Kbd>
          </div>

          {resultados.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-fg-muted">
              Nada encontrado para “{busca.trim()}”.
            </p>
          ) : (
            <ul className="flex max-h-[50vh] list-none flex-col overflow-y-auto p-1.5">
              {resultados.map(r => (
                <li key={`${r.tipo}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => abrir(r)}
                    className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left
                               text-[13px] text-fg-muted transition-colors
                               hover:bg-bg-hover hover:text-fg focus-visible:bg-bg-hover"
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
                    <span className="shrink-0 truncate text-[11px] text-fg-muted">{r.contexto}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
