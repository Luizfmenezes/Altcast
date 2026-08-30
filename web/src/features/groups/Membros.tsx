import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Crown, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import type { Papel } from '../../lib/tipos.js'

type MembroDoGrupo = {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: Papel
  joinedAt: string
}

const PAPEL_POR_EXTENSO: Record<Papel, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Membro',
}

/**
 * Membros do grupo, com promocao, rebaixamento e expulsao.
 *
 * A interface esconde o que o servidor recusaria, e isso e decisao de
 * APRESENTACAO — nunca de autorizacao. Quem contornar a tela recebe 404 de
 * `can.ts`, do outro lado. Nenhuma comparacao de papel feita aqui decide
 * coisa alguma; ela so evita oferecer um caminho sem saida.
 */
export function Membros({ groupId }: { groupId: string }): ReactNode {
  const [membros, setMembros] = useState<MembroDoGrupo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const eu = useStore(e => e.user)
  const grupo = useStore(e => e.groups.find(g => g.id === groupId))

  const souDono = grupo?.role === 'owner'
  const administro = souDono || grupo?.role === 'admin'

  async function recarregar(): Promise<void> {
    const lista = await api.get<MembroDoGrupo[]>(`/groups/${groupId}/members`)
      .catch(() => null)
    // Um corpo de forma inesperada nao pode derrubar a tela inteira no `.map`
    // logo abaixo: a lista vazia diz a verdade e mantem o resto de pe.
    if (Array.isArray(lista)) setMembros(lista)
  }

  useEffect(() => {
    let vigente = true
    api.get<MembroDoGrupo[]>(`/groups/${groupId}/members`)
      .then(lista => { if (vigente && Array.isArray(lista)) setMembros(lista) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [groupId])

  async function mudarPapel(userId: string, role: Papel): Promise<void> {
    setErro(null)
    setOcupado(userId)
    try {
      await api.patch(`/groups/${groupId}/members/${userId}`, { role })
      await recarregar()
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel mudar o cargo.')
    } finally {
      setOcupado(null)
    }
  }

  async function remover(userId: string): Promise<void> {
    setErro(null)
    setOcupado(userId)
    try {
      await api.delete(`/groups/${groupId}/members/${userId}`)
      await recarregar()
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel remover.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-fg">
          Membros <span className="numerico text-fg-muted">({membros.length})</span>
        </h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Administradores gerenciam canais e convites. So o dono muda cargos.
        </p>
      </div>

      {erro !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <ul className="flex list-none flex-col gap-1">
        {membros.map(membro => {
          const souEu = membro.userId === eu?.id
          const ehDono = membro.role === 'owner'
          const trabalhando = ocupado === membro.userId

          return (
            <li
              key={membro.userId}
              className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2
                         transition-colors hover:bg-bg-hover"
            >
              <Avatar nome={membro.displayName} url={membro.avatarUrl} tamanho="md" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">
                  {membro.displayName}
                  {souEu && <span className="ml-1.5 text-fg-muted">(voce)</span>}
                </p>
                <p className="flex items-center gap-1 text-[11px] text-fg-muted">
                  {ehDono && <Crown aria-hidden="true" className="size-3" />}
                  {membro.role === 'admin' && <ShieldCheck aria-hidden="true" className="size-3" />}
                  {PAPEL_POR_EXTENSO[membro.role]}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {/* So o dono muda cargos, e o cargo do proprio dono nao muda
                    por aqui: rebaixa-lo sem promover ninguem deixaria o grupo
                    sem dono, e o banco recusa. Transferir titularidade e um
                    caminho proprio. */}
                {souDono && !ehDono && (
                  membro.role === 'admin' ? (
                    <Botao
                      variante="discreto" tamanho="sm" disabled={trabalhando}
                      onClick={() => { void mudarPapel(membro.userId, 'member') }}
                    >
                      Rebaixar
                    </Botao>
                  ) : (
                    <Botao
                      variante="discreto" tamanho="sm" disabled={trabalhando}
                      onClick={() => { void mudarPapel(membro.userId, 'admin') }}
                    >
                      <UserPlus aria-hidden="true" />
                      Tornar admin
                    </Botao>
                  )
                )}

                {souDono && !ehDono && (
                  <ConfirmarAcao
                    titulo={`Transferir o grupo para ${membro.displayName}?`}
                    descricao={
                      'Voce deixa de ser dono e vira administrador. So a nova '
                      + 'pessoa dona podera desfazer isso.'
                    }
                    confirmar="Transferir"
                    aoConfirmar={() => { void mudarPapel(membro.userId, 'owner') }}
                    gatilho={
                      <Botao variante="discreto" tamanho="sm" disabled={trabalhando}>
                        <Crown aria-hidden="true" />
                        Transferir
                      </Botao>
                    }
                  />
                )}

                {administro && !ehDono && !souEu && (
                  <ConfirmarAcao
                    titulo={`Remover ${membro.displayName} do grupo?`}
                    descricao="A pessoa perde acesso aos canais. Pode voltar com um convite novo."
                    confirmar="Remover"
                    aoConfirmar={() => { void remover(membro.userId) }}
                    gatilho={
                      <Botao variante="fantasma" tamanho="iconeSm" disabled={trabalhando}>
                        <UserMinus aria-hidden="true" />
                        <span className="sr-only">Remover {membro.displayName}</span>
                      </Botao>
                    }
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
