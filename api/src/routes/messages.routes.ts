import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { messages } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor } from '../permissions/context.js'
import type { Actor, Resource } from '../permissions/can.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { parse, uuidOu404 } from './groups.routes.js'

type Message = typeof messages.$inferSelect

const PAGINA_PADRAO = 50
const PAGINA_MAXIMA = 100

const conteudo = z.string().trim().min(1).max(4000)

/**
 * O ID vem do cliente para que a mensagem apareca na tela antes da resposta do
 * servidor e depois seja reconciliada pela mesma chave — sem ID proprio, o eco
 * otimista viraria duplicata quando o WebSocket devolvesse a mesma mensagem.
 *
 * Exigir a versao 7, e nao um UUID qualquer, e o que garante que ordenar por
 * `id` continue sendo ordenar por tempo. Um v4 aceito aqui embaralharia o
 * historico de um canal para sempre.
 */
const enviarSchema = z.object({ id: z.uuidv7().optional(), content: conteudo })
const editarSchema = z.object({ content: conteudo })

const listarSchema = z.object({
  before: z.uuid().optional(),
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

function serializeMessage(m: Message): Record<string, unknown> {
  return {
    id: m.id, channelId: m.channelId, authorId: m.authorId, content: m.content,
    createdAt: m.createdAt, editedAt: m.editedAt,
  }
}

/**
 * Autor apagado deixa `author_id` nulo, e uma mensagem sem autor nao pertence
 * a ninguem: omitir o campo faz `message.edit_own` negar a todos, enquanto
 * `message.delete_any` continua valendo para quem administra.
 */
function recursoDaMensagem(m: Message): Resource {
  return m.authorId === null ? { kind: 'message' } : { kind: 'message', authorId: m.authorId }
}

/** Violacao de chave primaria: o cliente reenviou um ID que ja existe. */
function eIdDuplicado(erro: unknown): boolean {
  for (let atual: unknown = erro; atual !== null && atual !== undefined; ) {
    if (typeof atual !== 'object') return false
    if ('code' in atual && atual.code === '23505') return true
    atual = 'cause' in atual ? atual.cause : null
  }
  return false
}

/**
 * Carrega a mensagem viva e o ator no canal dela.
 *
 * A leitura do canal e verificada antes de qualquer decisao sobre a mensagem:
 * quem nao enxerga o canal nao pode descobrir, pelo status da resposta, que uma
 * mensagem existe la dentro. Mensagem ja apagada tambem nao existe.
 */
async function carregarParaEscrita(
  userId: string, messageId: string,
): Promise<{ mensagem: Message; actor: Actor }> {
  const [mensagem] = await db.select().from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt))).limit(1)
  if (!mensagem) throw new AppError('not_found')

  const carregado = await loadChannelActor(userId, mensagem.channelId)
  if (!carregado) throw new AppError('not_found')
  assertCan(carregado.actor, 'channel.read', {
    kind: 'channel', visibility: carregado.channel.visibility,
  })

  return { mensagem, actor: carregado.actor }
}

export async function messagesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/channels/:id/messages', { preHandler: requireAuth }, async req => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    assertCan(carregado.actor, 'channel.read', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    const { before, after, limit } = parse(listarSchema, req.query)

    // Comparar `id` e comparar tempo porque UUIDv7 e ordenavel, e usa o indice
    // (channel_id, id DESC) diretamente. OFFSET degradaria conforme o canal
    // crescesse — justamente nos canais mais usados.
    const linhas = await db.select().from(messages)
      .where(and(
        eq(messages.channelId, channelId),
        isNull(messages.deletedAt),
        before !== undefined ? lt(messages.id, before) : undefined,
        after !== undefined ? gt(messages.id, after) : undefined,
      ))
      .orderBy(desc(messages.id))
      .limit(Math.min(limit ?? PAGINA_PADRAO, PAGINA_MAXIMA))

    return linhas.map(serializeMessage)
  })

  app.post('/api/channels/:id/messages', {
    preHandler: requireAuth,
    // Spec 03 secao 6: 30 por minuto por usuario. Conversa humana nao chega
    // perto disso; inundacao automatizada passa disso na primeira segunda.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const userId = req.user!.id
    const carregado = await loadChannelActor(userId, channelId)
    if (!carregado) throw new AppError('not_found')
    assertCan(carregado.actor, 'message.create', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    const campos = parse(enviarSchema, req.body)

    try {
      const [criada] = await db.insert(messages).values({
        id: campos.id ?? newId(), channelId, authorId: userId, content: campos.content,
      }).returning()
      const dados = serializeMessage(criada!)
      // O autor tambem esta na audiencia: e o que mantem as outras abas dele
      // em dia e permite reconciliar o eco otimista pelo mesmo ID.
      await emit.toChannel(channelId, { t: 'message.created', d: dados })
      return reply.status(201).send(dados)
    } catch (erro) {
      // Reenviar o mesmo ID e o sintoma normal de um cliente que reconectou
      // sem saber se o primeiro POST chegou. O 409 diz "ja esta la", e o
      // cliente resolve mantendo o eco que ja tem na tela.
      if (eIdDuplicado(erro)) throw new AppError('message_id_taken')
      throw erro
    }
  })

  app.patch('/api/messages/:id', { preHandler: requireAuth }, async req => {
    const messageId = uuidOu404((req.params as { id: string }).id)
    const { mensagem, actor } = await carregarParaEscrita(req.user!.id, messageId)
    // Editar e do autor, e so dele: nem admin nem owner reescrevem a fala de
    // outra pessoa. Moderar e apagar, nao reescrever.
    assertCan(actor, 'message.edit_own', recursoDaMensagem(mensagem))

    const { content } = parse(editarSchema, req.body)
    const [editada] = await db.update(messages)
      .set({ content, editedAt: new Date() })
      .where(eq(messages.id, messageId)).returning()
    if (!editada) throw new AppError('not_found')

    const dados = serializeMessage(editada)
    await emit.toChannel(editada.channelId, { t: 'message.updated', d: dados })
    return dados
  })

  app.delete('/api/messages/:id', { preHandler: requireAuth }, async (req, reply) => {
    const messageId = uuidOu404((req.params as { id: string }).id)
    const { mensagem, actor } = await carregarParaEscrita(req.user!.id, messageId)
    assertCan(actor, 'message.delete_any', recursoDaMensagem(mensagem))

    // Soft delete: a linha permanece para que a chave nunca seja reaproveitada
    // e para que a moderacao continue auditavel. A listagem filtra por
    // deleted_at, entao apagada e apagada para quem le.
    await db.update(messages).set({ deletedAt: new Date() })
      .where(eq(messages.id, messageId))

    await emit.toChannel(mensagem.channelId, {
      t: 'message.deleted', d: { id: messageId, channelId: mensagem.channelId },
    })
    return reply.status(204).send()
  })
}
