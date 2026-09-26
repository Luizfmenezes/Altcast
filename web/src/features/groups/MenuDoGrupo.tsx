import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, LogOut, UserPlus, Users, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { Convidar } from './Convidar.js'
import { Membros } from './Membros.js'
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

type Painel = 'convidar' | 'membros' | null

export function MenuDoGrupo({ grupo }: { grupo: Grupo }): ReactNode {
  const [painel, setPainel] = useState<Painel>(null)
  const escolherGrupo = useStore(e => e.escolherGrupo)

  // Presentacional, e so: quem decide de verdade e o servidor, a cada rota.
  // Esconder aqui evita oferecer uma acao que voltaria 404, e nada alem disso.
  // `group.invite` exige cargo; ver a lista de membros, nao.
  const podeConvidar = grupo.role === 'owner' || grupo.role === 'admin'
  // O dono nao sai do proprio grupo: precisa transferir a titularidade antes,
  // e o servidor recusa com `owner_cannot_leave`.
  const podeSair = grupo.role !== 'owner'

  async function sair(): Promise<void> {
    const eu = useStore.getState().user?.id
    if (eu === undefined) return
    await api.delete(`/groups/${grupo.id}/members/${eu}`)
    // O `ready` do socket traz a lista sem este grupo; apontar para outro
    // agora evita a tela ficar num grupo que a pessoa acabou de deixar.
    const outro = useStore.getState().groups.find(g => g.id !== grupo.id)
    if (outro !== undefined) escolherGrupo(outro.id)
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[13px]
                       text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <span className="truncate">{grupo.name}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">Abrir menu do grupo</span>
          </button>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-52 rounded-lg border border-border-subtle bg-bg-raised p-1
                       shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]"
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
                      'Voce deixa de ver os canais e as conversas deste grupo. '
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
            className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,40rem)]
                       -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border
                       border-border-subtle bg-bg-raised p-4
                       shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                {painel === 'convidar' ? `Convidar para ${grupo.name}` : `Membros de ${grupo.name}`}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Botao variante="fantasma" tamanho="iconeSm">
                  <X aria-hidden="true" />
                  <span className="sr-only">Fechar</span>
                </Botao>
              </Dialog.Close>
            </div>

            {painel === 'convidar' && <Convidar groupId={grupo.id} />}
            {painel === 'membros' && <Membros groupId={grupo.id} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
