import { randomUUID } from 'node:crypto'

/**
 * Os pedidos para assistir uma transmissao, em memoria.
 *
 * Mesma natureza de `realtime/calls.ts`: um pedido so tem sentido enquanto a
 * transmissao esta no ar, e ninguem vai consulta-lo amanha. Reiniciar a API
 * esvazia a lista — quem pediu ve o pedido sem resposta e pode pedir de novo,
 * que e o mesmo que aconteceria com a transmissao caindo.
 *
 * O que fica no banco e o DESFECHO: um pedido aceito vira um convite dirigido
 * ja aceito (`group_invitations`), e e por ele que se sabe depois quem trouxe
 * quem para o grupo.
 */
export type PedidoParaAssistir = {
  id: string
  /** Quem transmite, e decide. */
  anfitriaoId: string
  solicitanteId: string
  groupId: string
  channelId: string
  criadoEm: number
}

/**
 * Dez minutos sem resposta e o pedido some.
 *
 * Nao e seguranca — aceitar continua exigindo a permissao de convidar. E
 * higiene: um cartao de "Fulano quer assistir" de uma transmissao que acabou ha
 * uma hora e ruido que ninguem sabe se ainda vale.
 */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000

const porId = new Map<string, PedidoParaAssistir>()

function vencido(p: PedidoParaAssistir, agora: number): boolean {
  return agora - p.criadoEm > VALIDADE_DO_PEDIDO_MS
}

function varrer(agora: number): void {
  for (const [id, p] of porId) if (vencido(p, agora)) porId.delete(id)
}

export const pedidos = {
  /**
   * Cria o pedido, ou devolve o que ja existe para a mesma pessoa e a mesma
   * transmissao. Clicar duas vezes no botao do Discord nao pode virar dois
   * cartoes na tela de quem transmite.
   */
  criar(dados: Omit<PedidoParaAssistir, 'id' | 'criadoEm'>, agora = Date.now()): {
    pedido: PedidoParaAssistir; novo: boolean
  } {
    varrer(agora)
    for (const p of porId.values()) {
      if (p.anfitriaoId === dados.anfitriaoId && p.solicitanteId === dados.solicitanteId
        && p.channelId === dados.channelId) {
        return { pedido: p, novo: false }
      }
    }
    const pedido = { ...dados, id: randomUUID(), criadoEm: agora }
    porId.set(pedido.id, pedido)
    return { pedido, novo: true }
  },

  obter(id: string, agora = Date.now()): PedidoParaAssistir | null {
    const p = porId.get(id)
    if (p === undefined) return null
    if (vencido(p, agora)) {
      porId.delete(id)
      return null
    }
    return p
  },

  /** Os pendentes de quem transmite — o que a tela mostra depois de recarregar. */
  doAnfitriao(anfitriaoId: string, agora = Date.now()): PedidoParaAssistir[] {
    varrer(agora)
    return [...porId.values()].filter(p => p.anfitriaoId === anfitriaoId)
  },

  remover(id: string): void {
    porId.delete(id)
  },

  clear(): void {
    porId.clear()
  },
}
