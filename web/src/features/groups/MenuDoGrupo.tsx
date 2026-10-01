import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, LogOut, Settings2, UserPlus, Users, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { possoNoGrupo, useStore } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { Convidar } from './Convidar.js'
import { Membros } from './Membros.js'
import { ConfiguracoesGrupo } from '../settings/ConfiguracoesGrupo.js'
import type { Grupo } from '../../lib/tipos.js'

/**
 * O menu do nome do grupo.
 *
 * Existe por um motivo medido: convidar alguem e ver quem esta no grupo eram
 * duas das acoes mais frequentes e as duas moravam dentro de Configuracoes >
 * Grupo — uma engrenagem no rodape da barra lateral, dois cliques e uma aba de
 * distancia. Quem acabou de criar um grupo nao encontra isso.
 *
 * As telas sao as MESMAS de dentro das configuracoes, e nao copias:
 * `ConfiguracoesGrupo` ja as monta, e duplicar faria duas versoes da mesma
 * coisa envelhecerem separadas. Duas portas, uma sala.
 *
 * `@radix-ui/react-dropdown-menu` ja era dependencia do projeto e nao tinha um
 * unico importador. Este e o uso dele.
 */

type Painel = 'convidar' | 'membros' | 'grupo' | null

const TITULO: Record<Exclude<Painel, null>, (nome: string) => string> = {
  convidar: nome => `Convidar para ${nome}`,
  membros: nome => `Membros de ${nome}`,
  grupo: nome => `Configurações de ${nome}`,
}

const PAPEL_POR_EXTENSO = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Membro',
} as const

export function MenuDoGrupo({ grupo, variante = 'linha' }: {
  grupo: Grupo
  /**
   * `linha` e o chip curto que cabia na barra do topo. `cabecalho` e a barra
   * larga no alto da coluna de canais — mesma sala, porta muito maior.
   *
   * A porta existia e quase ninguem achava: era um nome truncado com um chevron
   * de 14px no meio de uma barra que atravessava a tela inteira. Alvo grande
   * nao e enfeite aqui; e a diferenca entre a funcionalidade existir e a pessoa
   * saber que ela existe.
   */
  variante?: 'linha' | 'cabecalho'
}): ReactNode {
  const [painel, setPainel] = useState<Painel>(null)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const podeConvidar = useStore(e => possoNoGrupo(e, grupo.id, 'group.invite'))

  // Presentacional, e so: quem decide de verdade e o servidor, a cada rota.
  // Esconder aqui evita oferecer uma acao que voltaria 404, e nada alem disso.
  //
  // Vem da PERMISSAO resolvida, e nao mais de `role === 'admin'`. Com cargos,
  // convidar deixou de ser privilegio de administrador: um cargo qualquer pode
  // conceder `group.invite`, e amarrar a tela ao papel antigo esconderia o
  // botao justamente de quem o cargo acabou de habilitar.
  // O dono nao sai do proprio grupo: precisa transferir a titularidade antes,
  // e o servidor recusa com `owner_cannot_leave`.
  const podeSair = grupo.role !== 'owner'

  async function sair(): Promise<void> {
    const eu = useStore.getState().user?.id
    if (eu === undefined) return
    await api.delete(`/groups/${grupo.id}/members/${eu}`)
    // O `ready` do socket traz a lista sem este grupo; apontar para outro
    // agora evita a tela ficar num grupo que a pessoa acabou de deixar.
    const outro = useStore.getState().groups.find(g => g.id !== grupo.id && g.kind !== 'dm')
    if (outro !== undefined) escolherGrupo(outro.id)
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          {variante === 'cabecalho' ? (
            <button
              type="button"
              className="group/grupo flex w-full min-w-0 items-center gap-2 border-b
                         border-border-subtle px-3 py-2.5 text-left transition-colors
                         hover:bg-bg-hover data-[state=open]:bg-bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight text-fg">
                  {grupo.name}
                </span>
                <span className="block truncate text-xs leading-tight text-fg-muted">
                  {PAPEL_POR_EXTENSO[grupo.role]}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                strokeWidth={2.5}
                className="size-4 shrink-0 text-fg-muted transition-transform duration-200
                           group-hover/grupo:text-fg
                           group-data-[state=open]/grupo:rotate-180"
              />
              <span className="sr-only">Abrir menu do grupo</span>
            </button>
          ) : (
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[13px]
                         text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <span className="truncate">{grupo.name}</span>
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only">Abrir menu do grupo</span>
            </button>
          )}
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-52 rounded-lg border border-border-subtle bg-bg-raised p-1
                       shadow-popover"
          >
            {podeConvidar && (
              <Menu.Item
                onSelect={() => setPainel('convidar')}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[13px]
                           text-fg outline-none data-[highlighted]:bg-bg-hover"
              >
                <UserPlus aria-hidden="true" className="size-4" />
                Convidar pessoas
              </Menu.Item>
            )}

            <Menu.Item
              onSelect={() => setPainel('membros')}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[13px]
                         text-fg outline-none data-[highlighted]:bg-bg-hover"
            >
              <Users aria-hidden="true" className="size-4" />
              Membros
            </Menu.Item>

            {/*
              A MESMA tela da aba "Grupo" das configuracoes, e nao uma copia
              dela: `ConfiguracoesGrupo` monta canais, convite e membros de uma
              vez so. A aba continua existindo — quem ja aprendeu o caminho pela
              engrenagem nao perde nada; quem nunca o encontrou agora tropeça
              nele a partir do proprio grupo, que e onde a duvida nasce.
            */}
            {/*
              Sem gate: a tela de configuracoes decide por si quais secoes
              mostrar, e "Membros" vale para todo mundo que pertence ao grupo.
              Esconder a porta inteira de quem nao administra escondia junto a
              unica lista que responde "quem esta aqui?".
            */}
            {(
              <Menu.Item
                onSelect={() => setPainel('grupo')}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[13px]
                           text-fg outline-none data-[highlighted]:bg-bg-hover"
              >
                <Settings2 aria-hidden="true" className="size-4" />
                Configurações do grupo
              </Menu.Item>
            )}

            {podeSair && (
              <>
                <Menu.Separator className="my-1 h-px bg-border-subtle" />
                {/*
                  `onSelect` com `preventDefault` porque o menu fecharia antes
                  de a confirmacao aparecer, levando o dialogo junto.
                */}
                <Menu.Item
                  onSelect={evento => evento.preventDefault()}
                  className="flex min-h-9 items-center gap-2 rounded px-2 text-[13px]
                             text-danger outline-none data-[highlighted]:bg-bg-hover"
                >
                  <ConfirmarAcao
                    gatilho={
                      <button type="button" className="flex w-full items-center gap-2 text-left">
                        <LogOut aria-hidden="true" className="size-4" />
                        Sair do grupo
                      </button>
                    }
                    titulo={`Sair de ${grupo.name}?`}
                    descricao={
                      'Você deixa de ver os canais e as conversas deste grupo. '
                      + 'Para voltar, vai precisar de um convite novo.'
                    }
                    confirmar="Sair do grupo"
                    aoConfirmar={() => void sair()}
                  />
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      {/*
        Os paineis como dialogo, e nao como pagina: sao consultas rapidas no
        meio de uma conversa, e tirar a conversa da tela para mostrar uma lista
        de membros custaria o contexto de quem so queria conferir um nome.
      */}
      <Dialog.Root open={painel !== null} onOpenChange={aberto => { if (!aberto) setPainel(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(94vw,58rem)]
                       -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border
                       border-border-subtle bg-bg-raised p-4
                       shadow-popover"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                {painel === null ? '' : TITULO[painel](grupo.name)}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Botao variante="fantasma" tamanho="iconeSm">
                  <X aria-hidden="true" />
                  <span className="sr-only">Fechar</span>
                </Botao>
              </Dialog.Close>
            </div>

            {painel === 'convidar' ? <Convidar groupId={grupo.id} /> : null}
            {painel === 'membros' ? <Membros groupId={grupo.id} /> : null}
            {painel === 'grupo' ? <ConfiguracoesGrupo groupId={grupo.id} /> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
