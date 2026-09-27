import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { MailOpen } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Dica } from '../../ui/Tooltip.js'
import type { ConviteRecebido } from '../../lib/tipos.js'

/**
 * Os convites que chegaram para mim.
 *
 * E a metade visivel do convite dirigido: quem tem conta aqui nao recebe link
 * nenhum, recebe um item nesta lista — e o contador acende sozinho, pelo
 * evento `invitation.received`, sem recarregar a pagina.
 *
 * O botao so existe quando ha convite. Um envelope vazio permanente na coluna
 * seria um alvo que nunca vale a pena clicar, e a coluna e estreita demais
 * para gastar espaco com isso.
 */
export function Convites(): ReactNode {
  const convites = useStore(e => e.convites)
  const definirConvites = useStore(e => e.definirConvites)
  const removerConvite = useStore(e => e.removerConvite)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [emCurso, setEmCurso] = useState<string | null>(null)

  // Uma vez, na montagem: o que chegar depois vem pelo socket. Um intervalo de
  // sondagem aqui pediria ao servidor, a cada minuto, a resposta que ele ja
  // sabe empurrar no instante em que ela muda.
  useEffect(() => {
    let vigente = true
    api.get<ConviteRecebido[]>('/invitations')
      .then(lista => { if (vigente && Array.isArray(lista)) definirConvites(lista) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [definirConvites])

  async function responder(convite: ConviteRecebido, aceitar: boolean): Promise<void> {
    setErro(null)
    setEmCurso(convite.id)
    try {
      await api.post(`/invitations/${convite.id}/${aceitar ? 'accept' : 'decline'}`)
      removerConvite(convite.id)
      if (aceitar) {
        /**
         * Recarrega, e nao insere na store.
         *
         * Entrar num grupo traz junto os canais, os membros e os marcos de
         * leitura dele, e tudo isso vem do `ready` — que o servidor manda uma
         * vez, na conexao. Montar essas quatro listas a mao no cliente criaria
         * uma segunda fonte da verdade, que divergiria da primeira no primeiro
         * canal privado. Recarregar e o caminho curto para a verdade inteira.
         */
        window.location.reload()
        return
      }
      if (convites.length <= 1) setAberto(false)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível responder ao convite.')
      // Convite que sumiu do outro lado — revogado, ja aceito noutra aba —
      // nao pode continuar na tela prometendo um botao que nao funciona.
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        removerConvite(convite.id)
      }
    } finally {
      setEmCurso(null)
    }
  }

  if (convites.length === 0) return null

  return (
    <Dialogo.Root open={aberto} onOpenChange={setAberto}>
      <Dica texto={`${convites.length} convite${convites.length > 1 ? 's' : ''}`} lado="right">
        <Dialogo.Trigger asChild>
          <button
            type="button"
            className="relative flex size-10 items-center justify-center rounded
                       text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <MailOpen aria-hidden="true" className="size-5" />
            {/* O numero e para quem ve a coluna de relance; o texto abaixo diz
                a mesma coisa para quem navega por leitor de tela. */}
            <span
              aria-hidden="true"
              className="numerico absolute -right-0.5 -top-0.5 flex min-w-4 items-center
                         justify-center rounded-full bg-accent px-1 text-xs
                         font-semibold leading-4 text-accent-fg"
            >
              {convites.length}
            </span>
            <span className="sr-only">
              {convites.length === 1
                ? '1 convite para um grupo'
                : `${convites.length} convites para grupos`}
            </span>
          </button>
        </Dialogo.Trigger>
      </Dica>

      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,30rem)]
                     -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg
                     border border-border-subtle bg-bg-raised p-6 text-fg shadow-dialog"
        >
          <Dialogo.Title className="text-[15px] font-semibold text-fg">
            Convites para você
          </Dialogo.Title>
          <Dialogo.Description className="mt-1 text-[13px] text-fg-muted">
            Aceitar entra no grupo agora. Recusar não avisa quem convidou.
          </Dialogo.Description>

          {erro !== null && (
            <p role="alert"
              className="mt-4 rounded-md border border-danger px-3 py-2 text-sm text-danger">
              {erro}
            </p>
          )}

          <ul className="mt-4 flex list-none flex-col gap-2">
            {convites.map(convite => (
              <li
                key={convite.id}
                className="flex flex-wrap items-center gap-3 rounded-md border
                           border-border-subtle bg-bg px-3 py-3"
              >
                <Avatar nome={convite.group.name} url={convite.group.iconUrl} quadrado />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{convite.group.name}</p>
                  <p className="truncate text-[12px] text-fg-muted">
                    {convite.invitedBy.displayName} convidou você
                    {convite.role === 'admin' ? ' como administrador' : ''}
                  </p>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <Botao
                    variante="fantasma" tamanho="sm"
                    disabled={emCurso === convite.id}
                    onClick={() => { void responder(convite, false) }}
                  >
                    Recusar
                  </Botao>
                  <Botao
                    tamanho="sm"
                    disabled={emCurso === convite.id}
                    onClick={() => { void responder(convite, true) }}
                  >
                    {emCurso === convite.id ? 'Entrando...' : 'Aceitar'}
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
