import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  channelReads, groupMembers, mentions, messages, reactions, users,
} from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { emit } from '../realtime/emit.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * Reagir, marcar como lido, e resolver mencoes.
 *
 * As tres coisas moram juntas porque compartilham a natureza: sao fatos SOBRE
 * uma mensagem, e nao a mensagem. Nenhuma delas edita `content`, e nenhuma
 * delas precisa do caminho de escrita de mensagem — que tem limite de taxa,
 * anexos e eco otimista para cuidar.
 */

/**
 * O limite do que pode ser gravado como reacao.
 *
 * A coluna e `text`, entao sem guarda ela aceitaria um paragrafo inteiro se
 * fazendo passar por reacao — e a barra de reacoes da mensagem viraria um
 * segundo campo de texto, sem limite de tamanho e sem limite de taxa.
 *
 * Oito CODE POINTS, e nao oito caracteres: uma familia com quatro pessoas e
 * uma sequencia de sete code points unidos por ZWJ, e contar por `.length` em
 * JavaScript daria treze. O teste tambem exige que TUDO na sequencia seja
 * pictografico ou juncao — e o que separa "👨‍👩‍👧" de "oi 👍".
 */
const MAXIMO_DE_CODE_POINTS = 8

// Alternancia, e nao classe de caracteres: o juntador de largura zero e o
// seletor de variacao sao marcas COMBINANTES, e dentro de `[...]` eles se
// grudariam visualmente no caractere anterior — o padrao pareceria uma coisa
// e casaria outra.
const PARTE_DE_EMOJI =
  /^(?:[\p{Extended_Pictographic}\p{Emoji_Component}]|‍|️)+$/u

export function ehEmoji(bruto: string): boolean {
  if (bruto === '') return false
  if ([...bruto].length > MAXIMO_DE_CODE_POINTS) return false
  return PARTE_DE_EMOJI.test(bruto)
}

const reagirSchema = z.object({
  emoji: z.string().refine(ehEmoji, 'emoji invalido'),
})

const lerSchema = z.object({
  // Nulo e legitimo: e o "marcar o canal inteiro como nao lido".
  lastReadMessageId: z.uuid().nullable(),
})

export type ReacaoSerializada = { emoji: string; userIds: string[] }

/**
 * As reacoes de uma pagina inteira de mensagens, agrupadas por emoji.
 *
 * Uma consulta para a pagina toda, e nao uma por mensagem — cinquenta
 * mensagens dariam cinquenta idas ao banco para montar uma tela so, que e
 * exatamente o padrao que `anexosDe` ja evita ao lado.
 *
 * Devolve os `userIds`, e nao so a contagem, porque a interface precisa saber
 * se EU reagi para destacar a minha reacao — e mandar a contagem sozinha
 * obrigaria uma segunda consulta so para responder isso.
 */
export async function reacoesDe(
  messageIds: string[],
): Promise<Map<string, ReacaoSerializada[]>> {
  const porMensagem = new Map<string, ReacaoSerializada[]>()
  if (messageIds.length === 0) return porMensagem

  const linhas = await db.select().from(reactions)
    .where(inArray(reactions.messageId, messageIds))
    .orderBy(reactions.createdAt)

  for (const linha of linhas) {
    const lista = porMensagem.get(linha.messageId) ?? []
    // A ordem e a de chegada: quem reagiu primeiro define a posicao do emoji
    // na barra, e a barra nao se reordena sozinha enquanto a sala reage.
    const existente = lista.find(r => r.emoji === linha.emoji)
    if (existente) existente.userIds.push(linha.userId)
    else lista.push({ emoji: linha.emoji, userIds: [linha.userId] })
    porMensagem.set(linha.messageId, lista)
  }
  return porMensagem
}

/** As mencoes de uma pagina de mensagens, pelo mesmo motivo de `reacoesDe`. */
export async function mencoesDe(messageIds: string[]): Promise<Map<string, string[]>> {
  const porMensagem = new Map<string, string[]>()
  if (messageIds.length === 0) return porMensagem

  const linhas = await db.select().from(mentions)
    .where(inArray(mentions.messageId, messageIds))

  for (const linha of linhas) {
    porMensagem.set(linha.messageId, [...porMensagem.get(linha.messageId) ?? [], linha.userId])
  }
  return porMensagem
}

/**
 * Quem foi mencionado, resolvido AGORA contra quem esta no grupo agora.
 *
 * Resolver na escrita, e nao na leitura, e uma decisao de CORRECAO e nao de
 * desempenho: o apelido muda depois, e uma mencao que troca de dono quando
 * alguem se renomeia e um defeito impossivel de explicar para quem o sofre.
 *
 * O casamento e pelo `displayName` exato, do mais longo para o mais curto:
 * com "Ana" e "Ana Paula" no mesmo grupo, `@Ana Paula` precisa achar a
 * segunda — e testar a mais curta primeiro acharia so "Ana".
 */
export function extrairMencoes(
  conteudo: string, membros: { userId: string; displayName: string }[],
): { userIds: string[]; todos: boolean } {
  const todos = /(^|\s)@(todos|everyone)\b/u.test(conteudo)
  const encontrados = new Set<string>()

  const porTamanho = [...membros].sort((a, b) => b.displayName.length - a.displayName.length)
  for (const membro of porTamanho) {
    if (conteudo.includes(`@${membro.displayName}`)) encontrados.add(membro.userId)
  }

  return { userIds: [...encontrados], todos }
}

export async function chatRicoRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Reagir.
   *
   * A insercao usa `ON CONFLICT DO NOTHING` em vez de conferir antes: dois
   * cliques rapidos disparam dois POSTs, e uma checagem previa perderia a
   * corrida entre eles. A chave primaria e quem decide, e ela nao perde
   * corrida nenhuma.
   */
  app.post('/api/messages/:id/reactions', {
    preHandler: requireAuth,
    // Mais generoso que o de mensagem — reagir e um clique, e uma pessoa
    // reage a varias mensagens ao rolar a conversa — e ainda muito abaixo do
    // que uma automacao faria.
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const messageId = uuidOu404((req.params as { id: string }).id)
    const userId = req.user!.id
    const { emoji } = parse(reagirSchema, req.body)

    const alvo = await carregarAlvo(userId, messageId)

    await db.insert(reactions)
      .values({ messageId, userId, emoji })
      .onConflictDoNothing()

    await emit.toChannel(alvo.channelId, {
      t: 'reaction.added', d: { messageId, channelId: alvo.channelId, userId, emoji },
    })
    return reply.status(204).send()
  })

  app.delete('/api/messages/:id/reactions/:emoji', { preHandler: requireAuth }, async (
    req, reply,
  ) => {
    const messageId = uuidOu404((req.params as { id: string }).id)
    const userId = req.user!.id
    // O emoji vem da URL e chega percent-encoded. Validado mesmo assim: a rota
    // de remocao aceita o mesmo alfabeto que a de criacao, ou uma delas seria
    // uma porta mais larga que a outra.
    const emoji = decodeURIComponent((req.params as { emoji: string }).emoji)
    if (!ehEmoji(emoji)) throw new AppError('validation_failed')

    const alvo = await carregarAlvo(userId, messageId)

    await db.delete(reactions).where(and(
      eq(reactions.messageId, messageId),
      eq(reactions.userId, userId),
      eq(reactions.emoji, emoji),
    ))

    // Emitido mesmo quando nada foi removido: o cliente pode ter perdido o
    // evento de adicao, e um estado convergente vale mais do que economizar
    // um quadro de WebSocket.
    await emit.toChannel(alvo.channelId, {
      t: 'reaction.removed', d: { messageId, channelId: alvo.channelId, userId, emoji },
    })
    return reply.status(204).send()
  })

  /**
   * Ate onde eu li este canal.
   *
   * NAO passa pelo WebSocket, e a spec e explicita sobre isso: e estado da
   * PESSOA, e nao do canal, e nao interessa a mais ninguem. Emitir para a sala
   * contaria a todos quando cada um leu o que.
   */
  app.put('/api/channels/:id/read', { preHandler: requireAuth }, async (req, reply) => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const userId = req.user!.id

    const carregado = await loadChannelActor(userId, channelId)
    if (!carregado) throw new AppError('not_found')
    assertCan(carregado.actor, 'channel.read', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    const { lastReadMessageId } = parse(lerSchema, req.body)

    await db.insert(channelReads)
      .values({ channelId, userId, lastReadMessageId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [channelReads.channelId, channelReads.userId],
        set: { lastReadMessageId, updatedAt: new Date() },
      })

    return reply.status(204).send()
  })
}

/**
 * Carrega a mensagem viva e confere que quem age pode ESCREVER no canal dela.
 *
 * A leitura vem antes de qualquer outra decisao, como em toda rota de
 * mensagem: quem nao enxerga o canal nao pode descobrir, pelo status da
 * resposta, que uma mensagem existe la dentro. Por isso tudo aqui e 404, e
 * nunca 403.
 */
async function carregarAlvo(userId: string, messageId: string): Promise<{ channelId: string }> {
  const [mensagem] = await db.select({
    id: messages.id, channelId: messages.channelId, deletedAt: messages.deletedAt,
  }).from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!mensagem || mensagem.deletedAt !== null) throw new AppError('not_found')

  const carregado = await loadChannelActor(userId, mensagem.channelId)
  if (!carregado) throw new AppError('not_found')
  const recurso = { kind: 'channel' as const, visibility: carregado.channel.visibility }
  assertCan(carregado.actor, 'channel.read', recurso)
  assertCan(carregado.actor, 'message.react', recurso)

  return { channelId: mensagem.channelId }
}

/** Os marcos de leitura desta pessoa, para o `ready`. */
export async function leiturasDe(userId: string): Promise<Record<string, string | null>> {
  const linhas = await db.select().from(channelReads).where(eq(channelReads.userId, userId))
  return Object.fromEntries(linhas.map(l => [l.channelId, l.lastReadMessageId]))
}

/** Os membros de um grupo, para resolver `@nome` na escrita. */
export async function membrosParaMencao(
  groupId: string,
): Promise<{ userId: string; displayName: string }[]> {
  return db.select({ userId: groupMembers.userId, displayName: users.displayName })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
}
