import { asc, eq, max } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { channels } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { parse, uuidOu404 } from './groups.routes.js'

type Channel = typeof channels.$inferSelect

/**
 * A coluna aceita 'voice' desde a primeira migracao para que a Fatia 2 nao
 * vire retrabalho de schema. A API recusa ate que a midia exista de fato: sem
 * esta trava, um canal de voz criavel e inutilizavel entraria na barra lateral
 * como funcionalidade quebrada.
 */
const tipoSchema = z.literal('text').optional()

const nomeCru = z.string().min(1).max(64)
const topico = z.string().trim().max(256).nullable().optional()
const posicao = z.int().min(-1_000).max(1_000).optional()

const criarSchema = z.object({ name: nomeCru, type: tipoSchema, topic: topico })
const atualizarSchema = z.object({ name: nomeCru.optional(), topic: topico, position: posicao })
  .refine(v => v.name !== undefined || v.topic !== undefined || v.position !== undefined, {
    error: 'Informe ao menos um campo.', path: ['name'],
  })

/**
 * Um nome de canal e um identificador visivel, nao um titulo livre: minusculo,
 * sem acento e sem espaco, para que `#planejamento-semanal` seja digitavel e
 * comparavel sem ambiguidade. A normalizacao acontece no servidor porque o
 * indice unico `(group_id, name)` so protege o que ja chegou normalizado.
 */
export function normalizeChannelName(raw: string): string {
  const limpo = raw.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  // Cortar em 32 pode deixar um hifen orfao na ponta.
  return limpo.replace(/-+$/g, '')
}

/** Nome que sobra vazio depois da normalizacao nao e nome. */
function nomeOu422(raw: string): string {
  const nome = normalizeChannelName(raw)
  if (nome.length === 0) {
    throw new AppError('validation_failed', { name: ['Use letras ou numeros no nome do canal.'] })
  }
  return nome
}

/**
 * Violacao de unicidade do Postgres. O drizzle embrulha o erro do driver num
 * DrizzleQueryError, entao o `23505` pode estar uma camada abaixo — checar so
 * a superficie faria o 409 virar 500 em producao.
 */
function eNomeDuplicado(erro: unknown): boolean {
  for (let atual: unknown = erro; atual !== null && atual !== undefined; ) {
    if (typeof atual !== 'object') return false
    if ('code' in atual && atual.code === '23505') return true
    atual = 'cause' in atual ? atual.cause : null
  }
  return false
}

export function serializeChannel(c: Channel): Record<string, unknown> {
  return {
    id: c.id, groupId: c.groupId, name: c.name, type: c.type,
    visibility: c.visibility, topic: c.topic, position: c.position, createdAt: c.createdAt,
  }
}

/** Novo canal entra no fim da barra lateral, nunca disputando a posicao 0. */
async function proximaPosicao(groupId: string): Promise<number> {
  const [linha] = await db.select({ ultima: max(channels.position) })
    .from(channels).where(eq(channels.groupId, groupId))
  return (linha?.ultima ?? -1) + 1
}

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/groups/:id/channels', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'channel.create', { kind: 'channel' })

    const campos = parse(criarSchema, req.body)
    const nome = nomeOu422(campos.name)

    const linha = {
      id: newId(), groupId, name: nome,
      topic: campos.topic ?? null, position: await proximaPosicao(groupId),
    }

    // Confiar no indice unico em vez de consultar antes: entre o SELECT e o
    // INSERT cabe outro pedido com o mesmo nome, e o banco e o unico lugar
    // onde a corrida nao existe.
    try {
      const [criado] = await db.insert(channels).values(linha).returning()
      return reply.status(201).send(serializeChannel(criado!))
    } catch (erro) {
      if (eNomeDuplicado(erro)) throw new AppError('channel_name_taken')
      throw erro
    }
  })

  app.get('/api/groups/:id/channels', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    // Desempate por id — que e UUIDv7, portanto ordem de criacao — para que a
    // barra lateral nao troque de ordem sozinha entre dois carregamentos.
    const linhas = await db.select().from(channels)
      .where(eq(channels.groupId, groupId))
      .orderBy(asc(channels.position), asc(channels.id))

    return linhas.map(serializeChannel)
  })

  app.patch('/api/channels/:id', { preHandler: requireAuth }, async req => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    assertCan(carregado.actor, 'channel.update', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    const campos = parse(atualizarSchema, req.body)
    const mudancas = {
      ...(campos.name !== undefined ? { name: nomeOu422(campos.name) } : {}),
      ...(campos.topic !== undefined ? { topic: campos.topic } : {}),
      ...(campos.position !== undefined ? { position: campos.position } : {}),
    }

    try {
      const [atualizado] = await db.update(channels).set(mudancas)
        .where(eq(channels.id, channelId)).returning()
      if (!atualizado) throw new AppError('not_found')
      return serializeChannel(atualizado)
    } catch (erro) {
      if (eNomeDuplicado(erro)) throw new AppError('channel_name_taken')
      throw erro
    }
  })

  app.delete('/api/channels/:id', { preHandler: requireAuth }, async (req, reply) => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    // Eixo ADMINISTRAR: o admin apaga um canal privado abandonado sem nunca
    // ter podido le-lo. Spec 03 secao 9.
    assertCan(carregado.actor, 'channel.delete', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    // Mensagens e lista de acesso caem por ON DELETE CASCADE.
    await db.delete(channels).where(eq(channels.id, channelId))
    return reply.status(204).send()
  })
}
