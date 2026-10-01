import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { notificationPrefs, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { emit } from '../realtime/emit.js'
import { presence } from '../realtime/presence.js'
import { anunciarSeMudou, statusEfetivo } from '../realtime/status.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * O loop de atencao (Etapa 2 do super plano): o status da pessoa e o que ela
 * quer ouvir de cada grupo e de cada canal.
 *
 * Moram juntos porque respondem a mesma pergunta — "quando devo ser
 * interrompido?" — e nenhum dos dois e dado de grupo: e preferencia de UMA
 * pessoa, que so ela le e so ela escreve.
 */

const statusSchema = z.object({
  status: z.enum(['online', 'idle', 'dnd', 'invisible']),
  text: z.string().trim().max(128).nullable().optional(),
  emoji: z.string().trim().max(32).nullable().optional(),
  /** Quando o status volta sozinho para `online`. Nulo e "ate eu mudar". */
  expiresAt: z.iso.datetime().nullable().optional(),
})

const nivel = z.enum(['all', 'mentions', 'none'])

const preferenciaSchema = z.object({
  scopeType: z.enum(['group', 'channel']),
  scopeId: z.uuid(),
  /** Nulo e "herda do nivel de cima". */
  level: nivel.nullable(),
  /** Silencio temporario. Nulo desfaz. */
  mutedUntil: z.iso.datetime().nullable(),
})

export type PreferenciaSerializada = {
  scopeType: 'group' | 'channel'
  scopeId: string
  level: z.infer<typeof nivel> | null
  mutedUntil: string | null
}

function serializar(linha: typeof notificationPrefs.$inferSelect): PreferenciaSerializada {
  return {
    scopeType: linha.channelId === null ? 'group' : 'channel',
    scopeId: (linha.channelId ?? linha.groupId)!,
    level: linha.level,
    mutedUntil: linha.mutedUntil?.toISOString() ?? null,
  }
}

/** As preferencias desta pessoa, no formato da rota. */
export async function preferenciasDe(userId: string): Promise<PreferenciaSerializada[]> {
  const linhas = await db.select().from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
  return linhas.map(serializar)
}

export async function atencaoRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Trocar o proprio status.
   *
   * O escolhido vai para o banco — sobrevive a reconexao e ao outro aparelho —,
   * e o anuncio aos pares sai pelo status VISIVEL: quem fica invisivel some da
   * lista dos outros como se tivesse saido, e e so isso que eles ficam sabendo.
   */
  app.put('/api/auth/me/status', { preHandler: requireAuth }, async req => {
    const userId = req.user!.id
    const dados = parse(statusSchema, req.body)
    const expiraEm = dados.expiresAt == null ? null : new Date(dados.expiresAt)
    if (expiraEm !== null && expiraEm <= new Date()) throw new AppError('validation_failed')

    const [linha] = await db.update(users).set({
      status: dados.status,
      ...(dados.text === undefined ? {} : { statusText: dados.text === '' ? null : dados.text }),
      ...(dados.emoji === undefined ? {} : { statusEmoji: dados.emoji === '' ? null : dados.emoji }),
      statusExpiresAt: expiraEm,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({
      status: users.status, statusText: users.statusText, statusEmoji: users.statusEmoji,
      statusExpiresAt: users.statusExpiresAt,
    })
    if (!linha) throw new AppError('not_found')

    const efetivo = statusEfetivo(linha.status, linha.statusExpiresAt)
    const antes = presence.escolher(userId, efetivo)
    anunciarSeMudou(userId, antes, { statusText: linha.statusText, statusEmoji: linha.statusEmoji })

    const resposta = {
      status: efetivo,
      statusText: linha.statusText,
      statusEmoji: linha.statusEmoji,
      statusExpiresAt: linha.statusExpiresAt?.toISOString() ?? null,
    }
    // As outras abas e o desktop da mesma pessoa mudam juntos.
    emit.toUser(userId, { t: 'user.status', d: resposta })
    return resposta
  })

  app.get('/api/notification-prefs', { preHandler: requireAuth }, async req =>
    preferenciasDe(req.user!.id))

  /**
   * Definir o nivel de um grupo ou de um canal, ou silencia-lo por um tempo.
   *
   * O escopo tem de ser da pessoa: grupo do qual ela participa, canal que ela
   * enxerga. Fora disso, 404 — a mesma resposta de um id que nao existe, para
   * que a rota nao sirva de sonda.
   *
   * `level` e `mutedUntil` nulos juntos apagam a linha: "herdar sem silencio"
   * e exatamente o estado de quem nunca mexeu em nada.
   */
  app.put('/api/notification-prefs', { preHandler: requireAuth }, async req => {
    const userId = req.user!.id
    const dados = parse(preferenciaSchema, req.body)
    const escopo = uuidOu404(dados.scopeId)

    if (dados.scopeType === 'group') {
      const ator = await loadGroupActor(userId, escopo)
      if (ator.permissoes === null) throw new AppError('not_found')
    } else {
      const carregado = await loadChannelActor(userId, escopo)
      if (!carregado) throw new AppError('not_found')
      assertCan(carregado.actor, 'channel.read', {
        kind: 'channel', visibility: carregado.channel.visibility,
      })
    }

    const onde = dados.scopeType === 'group'
      ? and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.groupId, escopo),
        isNull(notificationPrefs.channelId))
      : and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.channelId, escopo))

    let resposta: PreferenciaSerializada
    if (dados.level === null && dados.mutedUntil === null) {
      await db.delete(notificationPrefs).where(onde)
      resposta = { scopeType: dados.scopeType, scopeId: escopo, level: null, mutedUntil: null }
    } else {
      const valores = {
        level: dados.level,
        mutedUntil: dados.mutedUntil === null ? null : new Date(dados.mutedUntil),
        updatedAt: new Date(),
      }
      // Atualiza ou insere — com o indice parcial unico como juiz, e nao uma
      // consulta antes: dois cliques rapidos nao podem criar duas linhas.
      const [atualizada] = await db.update(notificationPrefs).set(valores).where(onde).returning()
      const linha = atualizada ?? (await db.insert(notificationPrefs).values({
        userId,
        groupId: dados.scopeType === 'group' ? escopo : null,
        channelId: dados.scopeType === 'channel' ? escopo : null,
        ...valores,
      }).onConflictDoNothing().returning())[0]
      if (!linha) {
        // Perdeu a corrida para o clique irmao: a linha existe agora.
        const [depois] = await db.update(notificationPrefs).set(valores).where(onde).returning()
        resposta = serializar(depois!)
      } else {
        resposta = serializar(linha)
      }
    }

    emit.toUser(userId, { t: 'notification-prefs.updated', d: resposta })
    return resposta
  })
}
