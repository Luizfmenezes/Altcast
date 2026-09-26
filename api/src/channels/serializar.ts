import type { channels } from '../db/schema.js'

export type Channel = typeof channels.$inferSelect

/**
 * A forma do canal na API e nos eventos.
 *
 * Saiu de `channels.routes.ts` para ca quando os grupos ganharam eventos de
 * tempo real: `group.created` e `group.joined` precisam carregar os canais
 * junto — senao o cliente entra num grupo sem canal nenhum e a tela fica
 * vazia, que e o mesmo sintoma de antes com outra causa. Como
 * `channels.routes.ts` ja importa de `groups.routes.ts`, importar de volta
 * fecharia um ciclo; um modulo neutro resolve sem ninguem precisar lembrar
 * disso depois.
 *
 * Campo a campo, e nunca espalhando a linha: a coluna que nascer no banco
 * amanha nao vaza para a resposta por esquecimento.
 */
export function serializeChannel(c: Channel): Record<string, unknown> {
  return {
    id: c.id, groupId: c.groupId, name: c.name, type: c.type,
    visibility: c.visibility, topic: c.topic, position: c.position, createdAt: c.createdAt,
  }
}
