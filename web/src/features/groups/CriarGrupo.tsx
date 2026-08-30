import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { Plus, X } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { Dica } from '../../ui/Tooltip.js'
import type { Grupo } from '../../lib/tipos.js'

/**
 * Criacao de grupo.
 *
 * A API cria grupo, vinculo de dono e o canal #geral numa transacao so, entao
 * aqui nao ha etapa nenhuma para orquestrar: manda o nome e recebe um grupo
 * pronto para conversar.
 *
 * Conta sem e-mail confirmado recebe 403 do servidor. A interface nao esconde
 * o botao por isso — esconder deixaria a pessoa sem entender o que falta, e a
 * mensagem de erro do servidor diz exatamente o que fazer.
 */
export function CriarGrupo({ gatilho }: { gatilho?: ReactNode }): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const escolherGrupo = useStore(e => e.escolherGrupo)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const grupo = await api.post<Grupo & { id: string }>('/groups', { name: nome })
      // O `ready` do socket traz o grupo e os canais; aqui basta apontar para
      // ele. Inserir na store a mao criaria uma segunda fonte da verdade.
      escolherGrupo(grupo.id)
      setAberto(false)
      setNome('')
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel criar o grupo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo.Root open={aberto} onOpenChange={setAberto}>
      <Dialogo.Trigger asChild>
        {gatilho ?? (
          <Dica texto="Criar grupo" lado="right">
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-[10px] border
                         border-dashed border-border text-fg-muted transition-colors
                         hover:border-accent hover:text-accent"
            >
              <Plus aria-hidden="true" strokeWidth={2} className="size-5" />
              <span className="sr-only">Criar grupo</span>
            </button>
          </Dica>
        )}
      </Dialogo.Trigger>

      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm
                                    data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))]
                     -translate-x-1/2 -translate-y-1/2 rounded-xl border
                     border-border-subtle bg-bg-raised p-6
                     shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]
                     data-[state=open]:animate-in data-[state=open]:fade-in-0
                     data-[state=open]:zoom-in-95"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialogo.Title className="text-[15px] font-semibold text-fg">
                Criar um grupo
              </Dialogo.Title>
              <Dialogo.Description className="mt-1 text-[13px] text-fg-muted">
                Ele ja nasce com um canal #geral. Voce pode renomear depois.
              </Dialogo.Description>
            </div>
            <Dialogo.Close asChild>
              <Botao variante="fantasma" tamanho="iconeSm">
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Botao>
            </Dialogo.Close>
          </div>

          {erro !== null && (
            <p role="alert" className="mb-4 rounded-md border border-danger px-3 py-2
                                       text-sm text-danger">
              {erro}
            </p>
          )}

          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <Campo
              rotulo="Nome do grupo" valor={nome} aoMudar={setNome}
              espacoReservado="Anticorp" obrigatorio
            />
            <div className="flex justify-end gap-2">
              <Dialogo.Close asChild>
                <Botao type="button" variante="discreto">Cancelar</Botao>
              </Dialogo.Close>
              <Botao type="submit" disabled={enviando || nome.trim() === ''}>
                {enviando ? 'Criando...' : 'Criar grupo'}
              </Botao>
            </div>
          </form>
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
