import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import { db } from '../db/client.js'
import { channelMembers, channels, groups } from '../db/schema.js'
import { serializeChannel } from '../channels/serializar.js'
import { emit } from '../realtime/emit.js'

/**
 * Os eventos de grupo.
 *
 * Os canais sempre tiveram os seus — `channel.created`, `channel.updated`,
 * `channel.deleted` — e os grupos nunca tiveram nenhum. Era esse o buraco, e
 * nao tres defeitos distintos: criar um grupo, aceitar um convite, trocar o
 * nome e trocar a imagem falhavam todos da mesma maneira, porque nada no
 * sistema sabia dizer a um cliente que a lista de grupos DELE mudou. O `ready`
 * respondia isso uma vez, na conexao, e nunca mais — dai o refresh.
 *
 * Quatro funcoes, uma por acontecimento, todas passando pela fachada `emit`.
 * Nenhuma rota monta audiencia por conta propria: essa regra nao se afrouxa
 * porque a entidade mudou.
 */

/**
 * Os canais daquele grupo que ESTA pessoa pode ver.
 *
 * Repete a regra do `ready` de proposito — publico, ou privado com linha em
 * `channel_members` — e nao a regra mais simples "todos os canais do grupo".
 * Um grupo recem-criado so tem o #geral publico e os dois dariam no mesmo
 * hoje; entrar por convite num grupo com canais privados nao daria, e o evento
 * entregaria de brinde a existencia de canais que a spec 03 secao 9 manda nao
 * contar.
 */
async function canaisVisiveis(userId: string, groupId: string): Promise<unknown[]> {
  const linhas = await db.select(getTableColumns(channels))
    .from(channels)
    .leftJoin(channelMembers, and(
      eq(channelMembers.channelId, channels.id),
      eq(channelMembers.userId, userId),
    ))
    .where(and(
      eq(channels.groupId, groupId),
      or(eq(channels.visibility, 'public'), isNotNull(channelMembers.userId)),
    ))
    .orderBy(asc(channels.position), asc(channels.id))

  return linhas.map(serializeChannel)
}

/**
 * O grupo entrou para a lista desta pessoa.
 *
 * Serve a criacao (`group.created`) e a entrada por convite (`group.joined`).
 * Sao dois nomes porque o cliente reage diferente: quem CRIA vai para o grupo
 * novo na hora, e quem ACEITA um convite no meio de uma conversa nao pode ser
 * arrastado para fora dela.
 *
 * O evento carrega os canais junto. Sem eles o cliente ganharia um grupo sem
 * nenhum canal para abrir, e a tela ficaria vazia do mesmo jeito — o mesmo
 * sintoma de antes, com outra causa, que e a pior forma de consertar um bug.
 */
export async function emitirEntradaEmGrupo(
  tipo: 'group.created' | 'group.joined',
  userId: string,
  groupId: string,
  papel: 'owner' | 'admin' | 'member',
): Promise<void> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  if (!g) return

  emit.toUser(userId, {
    t: tipo,
    d: {
      group: { id: g.id, name: g.name, iconUrl: g.iconUrl, role: papel },
      channels: await canaisVisiveis(userId, groupId),
    },
  })
}

/**
 * O nome ou a imagem do grupo mudaram.
 *
 * Campos parciais de proposito: quem troca so a imagem manda so a imagem, e o
 * cliente funde o que chegou. E por isso que `iconUrl: null` — remover a
 * imagem — precisa ser distinguivel de "nao veio", do mesmo jeito que
 * `user.updated` ja faz com o avatar.
 */
export async function emitirGrupoAtualizado(
  groupId: string, campos: { name?: string; iconUrl?: string | null },
): Promise<void> {
  await emit.toGroup(groupId, { t: 'group.updated', d: { id: groupId, ...campos } })
}

/**
 * O grupo deixou de existir.
 *
 * A audiencia e calculada ANTES da remocao e passada pronta, pelo mesmo motivo
 * que `member.left` ja documenta: apagar um grupo destroi a propria audiencia,
 * e perguntar depois devolveria lista vazia — ninguem receberia o aviso, e
 * todos ficariam com um grupo fantasma na barra ate recarregar.
 */
export function emitirGrupoApagado(audiencia: readonly string[], groupId: string): void {
  emit.toUsers([...audiencia], { t: 'group.deleted', d: { id: groupId } })
}

/** Os grupos de uma pessoa, para o caso de varias entradas de uma vez —
 *  o resgate de convites que acontece no cadastro. */
export async function emitirEntradasEmLote(
  userId: string, groupIds: readonly string[],
): Promise<void> {
  if (groupIds.length === 0) return
  const existentes = await db.select({ id: groups.id }).from(groups)
    .where(inArray(groups.id, [...groupIds]))
  for (const g of existentes) {
    await emitirEntradaEmGrupo('group.joined', userId, g.id, 'member')
  }
}
