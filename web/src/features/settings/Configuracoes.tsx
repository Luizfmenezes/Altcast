import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Settings } from 'lucide-react'
import { ConfiguracoesGrupo } from './ConfiguracoesGrupo.js'
import { ConfiguracoesUsuario } from './ConfiguracoesUsuario.js'

type Aba = 'grupo' | 'conta'

/**
 * Porta de entrada das configuracoes.
 *
 * O dialogo vem do Radix porque ele resolve o que uma sobreposicao manual quase
 * sempre erra: prender o foco enquanto aberta, devolve-lo ao gatilho ao fechar
 * e reagir ao Escape (SC 2.1.2). O botao carrega rotulo textual mesmo com
 * icone, porque icone sozinho nao tem nome acessivel.
 */
export function Configuracoes({ groupId, podeAdministrar }: {
  groupId: string | null
  podeAdministrar: boolean
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [aba, setAba] = useState<Aba>('conta')

  const fechar = (): void => setAberto(false)

  return (
    <Dialog.Root open={aberto} onOpenChange={setAberto}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Configuracoes"
          className="flex size-10 items-center justify-center rounded text-fg-muted
                     hover:bg-bg-hover hover:text-fg"
        >
          <Settings aria-hidden="true" className="size-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(92vw,42rem)] -translate-x-1/2
                     -translate-y-1/2 overflow-y-auto rounded border border-border
                     bg-bg text-fg shadow-lg"
        >
          <Dialog.Title className="sr-only">Configuracoes</Dialog.Title>
          <Dialog.Description className="sr-only">
            Preferencias da sua conta e administracao do grupo.
          </Dialog.Description>

          <div
            role="tablist"
            aria-label="Secoes de configuracao"
            className="flex gap-1 border-b border-border-subtle px-4 pt-3"
          >
            <button
              type="button" role="tab" aria-selected={aba === 'conta'}
              onClick={() => setAba('conta')}
              className={`rounded-t px-3 py-2 text-sm ${
                aba === 'conta' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted'
              }`}
            >
              Sua conta
            </button>
            {podeAdministrar && groupId !== null && (
              <button
                type="button" role="tab" aria-selected={aba === 'grupo'}
                onClick={() => setAba('grupo')}
                className={`rounded-t px-3 py-2 text-sm ${
                  aba === 'grupo' ? 'border-b-2 border-accent text-fg' : 'text-fg-muted'
                }`}
              >
                Grupo
              </button>
            )}
          </div>

          {aba === 'conta' || groupId === null
            ? <ConfiguracoesUsuario aoFechar={fechar} />
            : <ConfiguracoesGrupo groupId={groupId} aoFechar={fechar} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
