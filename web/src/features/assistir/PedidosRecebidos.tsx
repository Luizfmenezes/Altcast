import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MonitorPlay } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { nativo } from '../../lib/nativo.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { usePedidosParaAssistir } from './pedidos.js'
import type { PedidoRecebido } from './pedidos.js'

/**
 * Os pedidos para assistir que chegaram para quem transmite.
 *
 * Um cartao por pedido, no canto da tela, sobre qualquer coisa que esteja
 * aberta: quem transmite esta olhando o jogo, e nao a lista de canais, e um
 * pedido escondido num menu ficaria sem resposta ate vencer.
 *
 * Aceitar e convidar. O servidor confere de novo a permissao no clique; o
 * cartao so aparece porque a pessoa tinha permissao quando o pedido chegou.
 */
export function PedidosRecebidos(): ReactNode {
  const recebidos = usePedidosParaAssistir(e => e.recebidos)
  const definirRecebidos = usePedidosParaAssistir(e => e.definirRecebidos)
  const remover = usePedidosParaAssistir(e => e.remover)
  const [emCurso, setEmCurso] = useState<string | null>(null)
  const [erro, setErro] = useState<{ id: string; texto: string } | null>(null)
  const quantos = useRef(0)

  // Uma vez, na montagem: depois de recarregar, os pendentes voltam. O que
  // chegar daqui em diante vem pelo socket.
  useEffect(() => {
    let vigente = true
    api.get<PedidoRecebido[]>('/pedidos-para-assistir')
      .then(lista => { if (vigente && Array.isArray(lista)) definirRecebidos(lista) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [definirRecebidos])

  // Pedido novo com a janela no fundo: pisca o icone na barra de tarefas.
  useEffect(() => {
    if (recebidos.length > quantos.current) {
      nativo()?.pedirAtencao?.({ tipo: 'chamada' }).catch(() => undefined)
    }
    quantos.current = recebidos.length
  }, [recebidos.length])

  async function responder(p: PedidoRecebido, aceitar: boolean): Promise<void> {
    setErro(null)
    setEmCurso(p.id)
    try {
      await api.post(`/pedidos-para-assistir/${p.id}/${aceitar ? 'aceitar' : 'recusar'}`)
      remover(p.id)
    } catch (e) {
      // Pedido que venceu ou ja foi respondido noutra aba nao fica na tela
      // prometendo um botao que nao funciona.
      if (e instanceof ApiError && e.status === 404) {
        remover(p.id)
        return
      }
      setErro({ id: p.id, texto: e instanceof ApiError ? e.message : 'Não foi possível responder.' })
    } finally {
      setEmCurso(null)
    }
  }

  if (recebidos.length === 0) return null

  return (
    <section
      aria-label="Pedidos para assistir"
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[min(22rem,calc(100%-2rem))]
                 flex-col gap-2"
    >
      {recebidos.map(p => (
        <article
          key={p.id}
          role="status"
          className="pointer-events-auto rounded-lg border border-border-subtle bg-bg-raised p-4
                     text-fg shadow-dialog"
        >
          <div className="flex items-start gap-3">
            <Avatar nome={p.solicitante.displayName} url={p.solicitante.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                <span className="font-semibold">{p.solicitante.displayName}</span> quer assistir
              </p>
              <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-fg-muted">
                <MonitorPlay aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{p.groupName} · {p.channelName}</span>
              </p>
              <p className="mt-1 text-[12px] text-fg-muted">Aceitar convida para o grupo.</p>
            </div>
          </div>

          {erro?.id === p.id && (
            <p role="alert" className="mt-3 rounded-md border border-danger px-3 py-2 text-sm text-danger">
              {erro.texto}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Botao
              variante="discreto" tamanho="sm" largura="cheia"
              disabled={emCurso === p.id}
              onClick={() => { void responder(p, false) }}
            >
              Recusar
            </Botao>
            <Botao
              tamanho="sm" largura="cheia"
              disabled={emCurso === p.id}
              onClick={() => { void responder(p, true) }}
            >
              Aceitar
            </Botao>
          </div>
        </article>
      ))}
    </section>
  )
}
