import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers } from '../db/schema.js'

/**
 * Calculo unico de audiencia do sistema.
 *
 * Nenhuma rota calcula audiencia por conta propria. E a regra que mantem todo o
 * risco de vazamento concentrado neste arquivo de poucas linhas, com cobertura
 * exigida em 100%, em vez de espalhado por dez rotas onde a decima esquece uma
 * condicao.
 *
 * Recurso inexistente devolve lista vazia em vez de lancar: emitir evento de
 * algo que acabou de ser apagado e normal numa corrida, e nao deveria derrubar
 * a requisicao que ja terminou com sucesso.
 */

/** Todos os membros do grupo. */
export async function audienceOfGroup(groupId: string): Promise<string[]> {
  const linhas = await db.select({ userId: groupMembers.userId })
    .from(groupMembers).where(eq(groupMembers.groupId, groupId))
  return linhas.map(l => l.userId)
}

/**
 * Canal publico: o grupo inteiro. Canal privado: exatamente a lista de acesso —
 * nem o owner, nem o admin entram aqui por serem quem sao. Se administrar
 * desse evento, "privado" perderia o sentido no exato ponto em que ele mais
 * importa: o conteudo em transito.
 */
export async function audienceOfChannel(channelId: string): Promise<string[]> {
  const [canal] = await db
    .select({ groupId: channels.groupId, visibility: channels.visibility })
    .from(channels).where(eq(channels.id, channelId)).limit(1)
  if (!canal) return []

  if (canal.visibility === 'private') {
    const linhas = await db.select({ userId: channelMembers.userId })
      .from(channelMembers).where(eq(channelMembers.channelId, channelId))
    return linhas.map(l => l.userId)
  }

  return audienceOfGroup(canal.groupId)
}

/**
 * Quem compartilha ao menos um grupo com o usuario — a audiencia de
 * `presence.update`. O Set e o que impede alguem que divide tres grupos de
 * receber o mesmo evento tres vezes.
 */
export async function audienceOfUser(userId: string): Promise<string[]> {
  const meus = await db.select({ groupId: groupMembers.groupId })
    .from(groupMembers).where(eq(groupMembers.userId, userId))
  if (meus.length === 0) return []

  const linhas = await db.select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, meus.map(m => m.groupId)))

  return [...new Set(linhas.map(l => l.userId))]
}
