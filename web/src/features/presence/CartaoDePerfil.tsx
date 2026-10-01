import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { MessageCircle, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { corDoMembro, ehConversa, useStore } from '../../lib/store.js'
import { abrirConversaCom } from '../../lib/conversas.js'
import type { PerfilPublico } from '../../lib/tipos.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { usePerfilAberto } from './perfilAberto.js'
import { Presenca, ROTULO_DE_PRESENCA, estaPresente } from './Presenca.js'
import { VisualDoPerfil } from './VisualDoPerfil.js'

/**
 * O cartao de uma pessoa: quem e, se esta online, e onde voces se cruzam.
 *
 * Abre NA HORA com o que o `ready` ja trouxe — nome, foto, presenca, grupos em
 * comum — e o perfil personalizado (banner, pronomes, "sobre mim") chega por
 * cima assim que a busca volta. Esperar a busca para abrir faria o cartao
 * parecer lento; abrir sem ela mostraria sempre um perfil pela metade.
 */

const FORMATO_DE_DATA = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })

/** O perfil completo de quem esta aberto. `null` enquanto nao chegou. */
function usePerfilPublico(userId: string | null): PerfilPublico | null {
  const [perfil, setPerfil] = useState<PerfilPublico | null>(null)
  useEffect(() => {
    setPerfil(null)
    if (userId === null) return
    let vigente = true
    void api.get<{ profile: PerfilPublico }>(`/users/${userId}/profile`)
      .then(r => { if (vigente) setPerfil(r.profile) })
      // Sem o perfil rico o cartao continua util com o que ja tinha.
      .catch(() => undefined)
    return () => { vigente = false }
  }, [userId])
  return perfil
}
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
  const perfil = usePerfilPublico(userId)

  const vinculos = userId === null ? [] : members.filter(m => m.userId === userId)
  const pessoa = vinculos.find(m => m.groupId === grupoAtivo) ?? vinculos[0]
  const emComum = groups.filter(g => !ehConversa(g) && vinculos.some(v => v.groupId === g.id))
  const [abrindo, setAbrindo] = useState(false)

  async function mandarMensagem(alvo: string): Promise<void> {
    setAbrindo(true)
    try {
      await abrirConversaCom(alvo)
      fechar()
    } catch {
      // O botao volta a ficar disponivel; tentar de novo e o caminho.
    } finally {
      setAbrindo(false)
    }
  }
  const cor = pessoa === undefined ? null : corDoMembro({ cargos, cargosDoMembro }, pessoa.groupId, pessoa.userId)
  const status = pessoa?.status ?? 'offline'
  const online = estaPresente(status)

  return (
    <Dialogo.Root open={userId !== null && pessoa !== undefined} onOpenChange={a => { if (!a) fechar() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2
                     -translate-y-1/2 overflow-hidden rounded-lg border border-border-subtle
                     bg-bg-raised shadow-dialog"
        >
          {pessoa !== undefined && (
            <>
              <VisualDoPerfil
                dados={{
                  displayName: perfil?.displayName ?? pessoa.displayName,
                  username: perfil?.username ?? null,
                  avatarUrl: perfil?.avatarUrl ?? pessoa.avatarUrl,
                  bio: perfil?.bio ?? null,
                  pronouns: perfil?.pronouns ?? null,
                  bannerColor: perfil?.bannerColor ?? null,
                  bannerUrl: perfil?.bannerUrl ?? null,
                }}
                cor={cor}
                cracha={<Presenca status={status} modo="cracha" />}
                titulo={nome => <Dialogo.Title asChild><h2>{nome}</h2></Dialogo.Title>}
                extra={
                  <>
                    <Dialogo.Description className="text-sm text-fg-muted">
                      {pessoa.userId === eu ? 'Você · ' : ''}{ROTULO_DE_PRESENCA[status]}
                      {(pessoa.statusText ?? '') !== '' && online && (
                        <span className="block text-fg">
                          {pessoa.statusEmoji ?? ''} {pessoa.statusText}
                        </span>
                      )}
                    </Dialogo.Description>

                    {pessoa.userId !== eu && emComum.length > 0 && (
                      <Botao
                        variante="primario"
                        largura="cheia"
                        className="rounded-full"
                        disabled={abrindo}
                        onClick={() => { void mandarMensagem(pessoa.userId) }}
                      >
                        <MessageCircle aria-hidden="true" />
                        {abrindo ? 'Abrindo…' : 'Enviar mensagem'}
                      </Botao>
                    )}

                    {perfil !== null && (
                      <p className="text-xs text-fg-muted">
                        No Altcast desde {FORMATO_DE_DATA.format(new Date(perfil.createdAt))}
                      </p>
                    )}

                    {emComum.length > 0 && (
                      <div>
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
                }
              />
              <Dialogo.Close asChild>
                <Botao
                  variante="fantasma"
                  tamanho="iconeSm"
                  className="absolute right-2 top-2 bg-bg/60 backdrop-blur-sm hover:bg-bg/80"
                >
                  <X aria-hidden="true" />
                  <span className="sr-only">Fechar</span>
                </Botao>
              </Dialogo.Close>
            </>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
