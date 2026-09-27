import { useEffect, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, Crown, ShieldCheck, Tags, UserMinus, UserPlus } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { chaveDoMembro, possoNoGrupo, useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import type { Cargo, Papel } from '../../lib/tipos.js'

/**
 * Os cargos de uma pessoa, como chips coloridos.
 *
 * Esta e a metade do sistema de cargos que nao tem nada a ver com permissao, e
 * e a metade que se ve o tempo todo: um cargo comunica quem e quem antes de
 * qualquer regra entrar em jogo. O cargo de todos nunca aparece — ele vale
 * para o grupo inteiro, e pintar todo mundo igual nao distingue ninguem.
 *
 * A cor entra como texto SOBRE um fundo da mesma cor a baixa opacidade, e
 * nunca como texto direto no fundo do tema. Cor de cargo e escolhida por
 * gente, e gente escolhe cinza-claro: sem o fundo proprio, a primeira escolha
 * infeliz derrubaria o contraste abaixo do minimo — e WCAG AA e requisito
 * deste projeto, nao revisao final.
 */
function ChipsDeCargo({ cargos }: { cargos: Cargo[] }): ReactNode {
  if (cargos.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {cargos.map(c => (
        <span
          key={c.id}
          className="cor-de-cargo inline-flex items-center gap-1 rounded px-1.5 py-px text-xs font-medium"
          style={c.color === null
            ? undefined
            : { '--cor-cargo': c.color, backgroundColor: `${c.color}1f` } as CSSProperties}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ backgroundColor: c.color ?? 'currentColor' }}
          />
          {c.name}
        </span>
      ))}
    </span>
  )
}

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
  const todosOsCargos = useStore(e => e.cargos)
  const cargosDoMembro = useStore(e => e.cargosDoMembro)
  const podeAtribuir = useStore(e => possoNoGrupo(e, groupId, 'group.change_role'))
  const podeRemover = useStore(e => possoNoGrupo(e, groupId, 'group.kick'))

  const souDono = grupo?.role === 'owner'

  /** Os cargos atribuiveis do grupo, do mais alto para o mais baixo. O de
   *  todos fica de fora: ele ja vale para todo mundo, e o servidor recusa
   *  atribui-lo. */
  const atribuiveis = Object.values(todosOsCargos)
    .filter(c => c.groupId === groupId && !c.isDefault)
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))

  const cargosDe = (userId: string): Cargo[] =>
    (cargosDoMembro[chaveDoMembro(groupId, userId)] ?? [])
      .map(id => todosOsCargos[id])
      .filter((c): c is Cargo => c !== undefined && !c.isDefault)
      .sort((a, b) => b.position - a.position)

  async function alternarCargo(userId: string, roleId: string, ligado: boolean): Promise<void> {
    setErro(null)
    const atuais = cargosDoMembro[chaveDoMembro(groupId, userId)] ?? []
    const proximos = ligado
      ? [...new Set([...atuais, roleId])]
      : atuais.filter(i => i !== roleId)
    try {
      // O estado FINAL, e nao "acrescente" ou "remova": a tela mostra caixas
      // marcadas, e mandar o conjunto inteiro e o que faz duas edicoes
      // simultaneas terminarem num estado que alguem escolheu, em vez de na
      // soma acidental das duas. O `member.roles_updated` atualiza a store.
      await api.put(`/groups/${groupId}/members/${userId}/roles`, { roleIds: proximos })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível mudar os cargos.')
    }
  }

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
      setErro(e instanceof ApiError ? e.message : 'Não foi possível mudar o cargo.')
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
      setErro(e instanceof ApiError ? e.message : 'Não foi possível remover.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        {/* A contagem fica, o titulo sai: a secao ja se chama "Membros" na
            tela de configuracoes, e o numero e a unica informacao nova. */}
        <p className="text-[13px] font-medium text-fg">
          <span className="numerico">{membros.length}</span>
          {membros.length === 1 ? ' pessoa' : ' pessoas'}
        </p>
        <p className="mt-1 text-[13px] text-fg-muted">
          O que cada pessoa pode fazer vem dos cargos dela. Quem tem mais de um soma o
          que cada um permite.
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
                  {souEu && <span className="ml-1.5 text-fg-muted">(você)</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  {ehDono && <Crown aria-hidden="true" className="size-3" />}
                  {membro.role === 'admin' && <ShieldCheck aria-hidden="true" className="size-3" />}
                  {PAPEL_POR_EXTENSO[membro.role]}
                  <ChipsDeCargo cargos={cargosDe(membro.userId)} />
                </p>
              </div>

              <div className="flex items-center gap-1">
                {/*
                  Cargos por ultimo na leitura e primeiro na acao: depois dos
                  cargos, e daqui que sai quase todo o poder de alguem. O
                  dono nao entra — ele atravessa toda permissao, e oferecer
                  cargos a ele sugeriria que tira-los mudaria algo.
                */}
                {podeAtribuir && !ehDono && atribuiveis.length > 0 && (
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Botao variante="discreto" tamanho="sm" disabled={trabalhando}>
                        <Tags aria-hidden="true" />
                        Cargos
                      </Botao>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content
                        align="end"
                        sideOffset={6}
                        className="z-[60] max-h-64 min-w-48 overflow-y-auto rounded-lg border
                                   border-border-subtle bg-bg-raised p-1 shadow-popover"
                      >
                        {atribuiveis.map(cargo => {
                          const tem = cargosDe(membro.userId).some(c => c.id === cargo.id)
                          return (
                            <Menu.CheckboxItem
                              key={cargo.id}
                              checked={tem}
                              // O menu nao fecha a cada marcacao: dar tres
                              // cargos a alguem sao tres cliques, e reabrir o
                              // menu entre eles e trabalho que a tela cria.
                              onSelect={e => e.preventDefault()}
                              onCheckedChange={marcado => {
                                void alternarCargo(membro.userId, cargo.id, marcado)
                              }}
                              className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2
                                         text-[13px] text-fg outline-none
                                         data-[highlighted]:bg-bg-hover"
                            >
                              <span
                                aria-hidden="true"
                                className="size-2.5 shrink-0 rounded-full border border-border-subtle"
                                style={{ backgroundColor: cargo.color ?? 'transparent' }}
                              />
                              <span className="min-w-0 flex-1 truncate">{cargo.name}</span>
                              <Menu.ItemIndicator>
                                <Check aria-hidden="true" className="size-3.5 text-accent" />
                              </Menu.ItemIndicator>
                            </Menu.CheckboxItem>
                          )
                        })}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                )}
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
                      'Você deixa de ser dono e vira administrador. Só a nova '
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

                {podeRemover && !ehDono && !souEu && (
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
