import { registry } from './registry.js'
import { audienceOfChannel, audienceOfGroup, audienceOfUser } from './fanout.js'

/** Envelope unico da spec 04: `t` de tipo, `d` de dados. */
export type Event = { t: string; d: unknown }

const ABERTO = 1

/**
 * Fachada unica de emissao. Toda rota emite por aqui, e a audiencia vem sempre
 * de fanout.ts — nenhuma rota monta a propria lista de destinatarios.
 *
 * Falha de envio nunca sobe: o WebSocket tem permissao para perder eventos, e
 * o cliente cura o buraco por REST ao reconectar. Derrubar uma escrita que ja
 * foi confirmada no banco porque um socket morreu seria trocar um problema
 * invisivel por um erro visivel e falso.
 */
function enviar(userIds: string[], evento: Event): void {
  if (userIds.length === 0) return
  const carga = JSON.stringify(evento)
  for (const socket of registry.socketsOf(userIds)) {
    if (socket.readyState !== ABERTO) continue
    try {
      socket.send(carga)
    } catch {
      // Socket que morreu entre a checagem e o envio. O heartbeat o remove.
    }
  }
}

export const emit = {
  toChannel: async (channelId: string, evento: Event): Promise<void> =>
    enviar(await audienceOfChannel(channelId), evento),

  toGroup: async (groupId: string, evento: Event): Promise<void> =>
    enviar(await audienceOfGroup(groupId), evento),

  /** Quem compartilha ao menos um grupo — a audiencia de `presence.update`. */
  toPeersOf: async (userId: string, evento: Event): Promise<void> =>
    enviar(await audienceOfUser(userId), evento),

  toUser: (userId: string, evento: Event): void => enviar([userId], evento),

  /**
   * Lista ja calculada. Existe para o caso em que a audiencia precisa ser
   * capturada ANTES da escrita — apagar um canal destroi a propria audiencia,
   * e perguntar depois devolveria lista vazia.
   */
  toUsers: (userIds: string[], evento: Event): void => enviar(userIds, evento),
}
