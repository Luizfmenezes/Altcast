import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { corDoMembro, useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { usePerfilAberto } from './perfilAberto.js'

/**
 * O cartao de uma pessoa: quem e, se esta online, e onde voces se cruzam.
 *
 * Mostra so o que o cliente ja recebeu no `ready` — nome, avatar, presenca e
 * os grupos em comum. Nao busca nada: a regra da store vale aqui tambem, e o
 * cartao nunca deduz o que nao chegou. O perfil rico (bio, pronomes, banner)
 * cresce dentro desta mesma moldura.
 */
export function CartaoDePerfil(): ReactNode {
  const userId = usePerfilAberto(e => e.userId)
  const fechar = usePerfilAberto(e => e.fecharPerfil)
  const members = useStore(e => e.members)
  const groups = useStore(e => e.groups)
  const cargos = useStore(e => e.cargos)
  const cargosDoMembro = useStore(e => e.cargosDoMembro)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const eu = useStore(e => e.user?.id ?? null)
  const escolherGrupo = useStore(e => e.escolherGrupo)

  const vinculos = userId === null ? [] : members.filter(m => m.userId === userId)
  const pessoa = vinculos.find(m => m.groupId === grupoAtivo) ?? vinculos[0]
  const emComum = groups.filter(g => vinculos.some(v => v.groupId === g.id))
  const cor = pessoa === undefined ? null : corDoMembro({ cargos, cargosDoMembro }, pessoa.groupId, pessoa.userId)
  const online = vinculos.some(v => v.status === 'online')

  return (
    <Dialogo.Root open={userId !== null && pessoa !== undefined} onOpenChange={a => { if (!a) fechar() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2
                     -translate-y-1/2 rounded-xl border border-border-subtle bg-bg-raised p-5
                     shadow-dialog"
        >
          {pessoa !== undefined && (
            <>
              <div className="flex items-start gap-3">
                <span className="relative">
                  <Avatar nome={pessoa.displayName} url={pessoa.avatarUrl} tamanho="xl" />
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 right-0 size-4 rounded-full border-[3px]
                                border-bg-raised ${online ? 'bg-presence-online' : 'bg-fg-muted'}`}
                  />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <Dialogo.Title
                    className="truncate text-lg font-semibold text-fg"
                    style={cor === null ? undefined : { color: cor }}
                  >
                    {pessoa.displayName}
                  </Dialogo.Title>
                  <Dialogo.Description className="text-sm text-fg-muted">
                    {pessoa.userId === eu ? 'Você' : online ? 'Online agora' : 'Offline'}
                  </Dialogo.Description>
                </div>
                <Dialogo.Close asChild>
                  <Botao variante="fantasma" tamanho="iconeSm">
                    <X aria-hidden="true" />
                    <span className="sr-only">Fechar</span>
                  </Botao>
                </Dialogo.Close>
              </div>

              {emComum.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {pessoa.userId === eu ? 'Seus grupos' : 'Grupos em comum'}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {emComum.map(g => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => { escolherGrupo(g.id); fechar() }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left
                                     text-sm text-fg hover:bg-bg-hover"
                        >
                          <Avatar nome={g.name} url={g.iconUrl} tamanho="sm" />
                          <span className="min-w-0 truncate">{g.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
