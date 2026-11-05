import { create } from 'zustand'
import type { ServerEvent } from '../../lib/socket.js'

/**
 * Os pedidos para assistir uma transmissao — dos dois lados.
 *
 * Quem transmite guarda os que chegaram (`recebidos`), e cada um vira um
 * cartao com Aceitar e Recusar. Quem pediu guarda a resposta (`respostas`),
 * que e o que a tela de espera observa.
 *
 * Fica fora de `lib/store.ts` pelo mesmo motivo de `chamadaAtiva.ts`: e um
 * estado com vida curta e dono claro, e nao precisa morar dentro do estado que
 * a aplicacao inteira le e que todo teste monta.
 */
export type PedidoRecebido = {
  id: string
  groupId: string
  groupName: string
  channelId: string
  channelName: string
  solicitante: { id: string; displayName: string; avatarUrl: string | null }
  criadoEm: string
}

export type Resposta =
  | { tipo: 'aceito'; groupId: string; channelId: string }
  | { tipo: 'recusado' }

type EstadoDosPedidos = {
  recebidos: PedidoRecebido[]
  respostas: Record<string, Resposta>
  definirRecebidos: (lista: PedidoRecebido[]) => void
  remover: (id: string) => void
  limpar: () => void
}

export const usePedidosParaAssistir = create<EstadoDosPedidos>(set => ({
  recebidos: [],
  respostas: {},
  definirRecebidos: lista => set({ recebidos: lista }),
  remover: id => set(e => ({ recebidos: e.recebidos.filter(p => p.id !== id) })),
  limpar: () => set({ recebidos: [], respostas: {} }),
}))

/** Aplica um evento do socket, se for deste assunto. Devolve se era. */
export function aplicarEventoDePedido(evento: ServerEvent): boolean {
  const d = evento.d as Record<string, unknown>
  switch (evento.t) {
    case 'watch_request.received': {
      const p = d as unknown as PedidoRecebido
      // Sem duplicar: o mesmo evento chega duas vezes numa reconexao.
      usePedidosParaAssistir.setState(e => ({
        recebidos: [...e.recebidos.filter(v => v.id !== p.id), p],
      }))
      return true
    }
    case 'watch_request.closed':
      usePedidosParaAssistir.getState().remover(String(d.id))
      return true
    case 'watch_request.accepted':
      usePedidosParaAssistir.setState(e => ({
        respostas: {
          ...e.respostas,
          [String(d.id)]: { tipo: 'aceito', groupId: String(d.groupId), channelId: String(d.channelId) },
        },
      }))
      return true
    case 'watch_request.declined':
      usePedidosParaAssistir.setState(e => ({
        respostas: { ...e.respostas, [String(d.id)]: { tipo: 'recusado' } },
      }))
      return true
    default:
      return false
  }
}
