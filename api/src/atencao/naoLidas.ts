import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

/**
 * Quantas mensagens cada canal tem depois do marco de leitura — e quantas
 * delas me mencionam. Decisao D3-C do super plano.
 *
 * O cliente contava sozinho, com o que tinha em memoria. Isso errava no caso
 * mais importante: o canal que a pessoa nunca abriu nesta sessao nao tem
 * historico local, e a contagem dele era sempre zero. Recarregar a pagina
 * zerava todas as bolinhas.
 *
 * A contagem DERIVA do marco (`channel_reads`), como o schema sempre quis —
 * nenhum contador materializado a reescrever por mensagem. E tem teto de 100
 * por canal: a subconsulta para no centesimo resultado, o que torna o custo
 * constante mesmo num canal com cem mil mensagens nao lidas, e a interface
 * mostra "99+" a partir dai.
 *
 * Sem marco nenhum (canal nunca aberto), o marco e a entrada no grupo: o que
 * foi dito antes de a pessoa chegar nao e "nao lido", e contar isso poria
 * "99+" em todo canal antigo de um grupo recem-aceito.
 *
 * Mensagem propria nao conta; apagada tambem nao. Mencao conta a direta e a
 * `@todos`.
 *
 * Recebe os canais JA filtrados pela visibilidade de quem pergunta: esta
 * funcao nao decide o que a pessoa pode ver, so conta o que lhe foi entregue.
 */

export const TETO_DE_NAO_LIDAS = 100

export type NaoLidas = { n: number; mentions: number }

export async function naoLidasPorCanal(
  userId: string, channelIds: readonly string[],
): Promise<Record<string, NaoLidas>> {
  if (channelIds.length === 0) return {}

  const resultado = await db.execute<{ channel_id: string; n: string; mentions: string }>(sql`
    WITH alvo AS (
      SELECT c.id AS channel_id,
             r.last_read_message_id AS marco,
             gm.joined_at AS entrada
        FROM channels c
        JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = ${userId}
        LEFT JOIN channel_reads r ON r.channel_id = c.id AND r.user_id = ${userId}
       WHERE c.id IN (${sql.join(channelIds.map(id => sql`${id}::uuid`), sql`, `)})
    )
    SELECT a.channel_id,
      (SELECT count(*) FROM (
         SELECT 1 FROM messages m
          WHERE m.channel_id = a.channel_id
            AND m.deleted_at IS NULL
            AND m.author_id IS DISTINCT FROM ${userId}
            AND (CASE WHEN a.marco IS NULL THEN m.created_at > a.entrada ELSE m.id > a.marco END)
          LIMIT ${TETO_DE_NAO_LIDAS}
      ) x) AS n,
      (SELECT count(*) FROM (
         SELECT 1 FROM messages m
          WHERE m.channel_id = a.channel_id
            AND m.deleted_at IS NULL
            AND m.author_id IS DISTINCT FROM ${userId}
            AND (CASE WHEN a.marco IS NULL THEN m.created_at > a.entrada ELSE m.id > a.marco END)
            AND (m.mentions_everyone
                 OR EXISTS (SELECT 1 FROM mentions me WHERE me.message_id = m.id AND me.user_id = ${userId}))
          LIMIT ${TETO_DE_NAO_LIDAS}
      ) y) AS mentions
    FROM alvo a
  `)

  const porCanal: Record<string, NaoLidas> = {}
  for (const linha of resultado.rows) {
    const n = Number(linha.n)
    const mentions = Number(linha.mentions)
    // Canal sem nada nao entra: o cliente le ausencia como zero, e a
    // fotografia inicial fica do tamanho do que importa.
    if (n > 0 || mentions > 0) porCanal[linha.channel_id] = { n, mentions }
  }
  return porCanal
}
