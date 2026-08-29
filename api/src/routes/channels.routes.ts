import { and, asc, eq, getTableColumns, isNotNull, max, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { channelMembers, channels, groupMembers, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor, loadGroupActor } from '../permissions/context.js'
import { can, type Actor, type Resource } from '../permissions/can.js'
import type { Database } from '../db/client.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { audienceOfChannel } from '../realtime/fanout.js'
import { parse, uuidOu404 } from './groups.routes.js'

type Channel = typeof channels.$inferSelect
type Transacao = Parameters<Parameters<Database['transaction']>[0]>[0]

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

const visibilidade = z.enum(['public', 'private']).optional()

const criarSchema = z.object({
  name: nomeCru, type: tipoSchema, topic: topico, visibility: visibilidade,
})
const atualizarSchema = z.object({
  name: nomeCru.optional(), topic: topico, position: posicao, visibility: visibilidade,
}).refine(v => Object.values(v).some(campo => campo !== undefined), {
  error: 'Informe ao menos um campo.', path: ['name'],
})
const membroSchema = z.object({ userId: z.uuid() })

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

/**
 * A lista de acesso so existe para canal privado. Canal publico tira o acesso
 * do grupo, e manter linhas ali seria acesso fantasma esperando o canal voltar
 * a ser privado.
 */
function exigePrivado(canal: Channel): void {
  if (canal.visibility === 'private') return
  throw new AppError('validation_failed', {
    userId: ['Canal publico da acesso a todo o grupo; nao tem lista propria.'],
  })
}

/**
 * Ver a lista de acesso e um `ou` entre os dois eixos, e por isso precisa de
 * duas perguntas a `can()` em vez de uma condicao propria — a decisao continua
 * inteira dentro de permissions/can.ts.
 */
function podeVerLista(actor: Actor, recurso: Resource): boolean {
  return can(actor, 'channel.read', recurso) || can(actor, 'channel.manage_members', recurso)
}

/** O alvo precisa ja pertencer ao grupo: canal nao e porta de entrada. */
async function membroDoGrupoOu404(groupId: string, userId: string): Promise<void> {
  const [m] = await db.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).limit(1)
  if (!m) throw new AppError('not_found')
}

/**
 * Toda troca de visibilidade zera a lista de acesso, e virar privado recomeca
 * dela com quem fez a mudanca.
 *
 * Zerar ao virar publico nao e limpeza cosmetica: se a lista sobrevivesse, o
 * canal voltando a privado ressuscitaria em silencio o acesso de quem ja tinha
 * sido tirado dali.
 */
async function trocarVisibilidade(
  tx: Transacao, canal: Channel, nova: 'public' | 'private', autor: string,
): Promise<void> {
  await tx.delete(channelMembers).where(eq(channelMembers.channelId, canal.id))
  if (nova === 'private') {
    await tx.insert(channelMembers)
      .values({ channelId: canal.id, userId: autor, addedBy: autor })
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
    const userId = req.user!.id
    const actor = await loadGroupActor(userId, groupId)
    assertCan(actor, 'channel.create', { kind: 'channel' })

    const campos = parse(criarSchema, req.body)
    const nome = nomeOu422(campos.name)

    const visibility = campos.visibility ?? 'public'
    const linha = {
      id: newId(), groupId, name: nome, visibility,
      topic: campos.topic ?? null, position: await proximaPosicao(groupId),
    }

    // Confiar no indice unico em vez de consultar antes: entre o SELECT e o
    // INSERT cabe outro pedido com o mesmo nome, e o banco e o unico lugar
    // onde a corrida nao existe.
    try {
      const criado = await db.transaction(async tx => {
        const [c] = await tx.insert(channels).values(linha).returning()
        // Quem cria um canal privado entra nele. Um canal privado sem ninguem
        // dentro nasceria ilegivel ate para o proprio autor.
        if (visibility === 'private') {
          await tx.insert(channelMembers)
            .values({ channelId: c!.id, userId, addedBy: userId })
        }
        return c!
      })
      // Depois do commit, nunca dentro dele: anunciar de dentro da transacao
      // seria contar um fato que um rollback ainda pode desfazer.
      const dados = serializeChannel(criado)
      await emit.toChannel(criado.id, { t: 'channel.created', d: dados })
      return reply.status(201).send(dados)
    } catch (erro) {
      if (eNomeDuplicado(erro)) throw new AppError('channel_name_taken')
      throw erro
    }
  })

  app.get('/api/groups/:id/channels', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    // O LEFT JOIN com o filtro no ON e o que faz um unico SELECT resolver as
    // duas regras: canal publico entra sempre, privado so quando existe linha
    // em channel_members para quem pergunta. Buscar tudo e filtrar em memoria
    // depois funcionaria — e seria exatamente o atalho que um refactor futuro
    // esquece de refazer, transformando invisivel em visivel.
    //
    // Desempate por id — que e UUIDv7, portanto ordem de criacao — para que a
    // barra lateral nao troque de ordem sozinha entre dois carregamentos.
    const linhas = await db.select(getTableColumns(channels)).from(channels)
      .leftJoin(channelMembers, and(
        eq(channelMembers.channelId, channels.id),
        eq(channelMembers.userId, req.user!.id),
      ))
      .where(and(
        eq(channels.groupId, groupId),
        or(eq(channels.visibility, 'public'), isNotNull(channelMembers.userId)),
      ))
      .orderBy(asc(channels.position), asc(channels.id))

    return linhas.map(serializeChannel)
  })

  app.get('/api/channels/:id', { preHandler: requireAuth }, async req => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    // Eixo LER: vem do pertencimento ao canal, jamais do papel no grupo. E por
    // isso que o admin de fora leva 404 aqui e 204 no DELETE.
    assertCan(carregado.actor, 'channel.read', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })
    return serializeChannel(carregado.channel)
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
      ...(campos.visibility !== undefined ? { visibility: campos.visibility } : {}),
    }
    // Repetir a visibilidade atual e um no-op deliberado: sem esta guarda, um
    // PATCH que so mexe no topico e reenvia `visibility` apagaria a lista de
    // acesso inteira sem que ninguem tivesse pedido isso.
    const novaVisibilidade = campos.visibility !== undefined
      && campos.visibility !== carregado.channel.visibility
      ? campos.visibility : null

    // A audiencia e capturada antes porque uma troca de visibilidade a
    // reescreve: quem perdeu acesso precisa saber pela audiencia ANTIGA, e
    // quem ganhou, pela nova.
    const antes = await audienceOfChannel(channelId)

    try {
      const atualizado = await db.transaction(async tx => {
        const [c] = await tx.update(channels).set(mudancas)
          .where(eq(channels.id, channelId)).returning()
        if (!c) throw new AppError('not_found')
        if (novaVisibilidade !== null) {
          await trocarVisibilidade(tx, c, novaVisibilidade, req.user!.id)
        }
        return c
      })

      const dados = serializeChannel(atualizado)
      const depois = await audienceOfChannel(channelId)
      // Para quem perdeu o acesso o canal nao mudou: ele deixou de existir.
      emit.toUsers(antes.filter(id => !depois.includes(id)),
        { t: 'channel.deleted', d: { id: channelId, groupId: atualizado.groupId } })
      emit.toUsers(depois.filter(id => !antes.includes(id)),
        { t: 'channel.created', d: dados })
      emit.toUsers(depois.filter(id => antes.includes(id)),
        { t: 'channel.updated', d: dados })

      return dados
    } catch (erro) {
      if (eNomeDuplicado(erro)) throw new AppError('channel_name_taken')
      throw erro
    }
  })

  app.get('/api/channels/:id/members', { preHandler: requireAuth }, async req => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    const recurso = { kind: 'channel' as const, visibility: carregado.channel.visibility }
    // Ler a lista e um `ou`: quem participa precisa saber com quem fala, e quem
    // administra precisa da tela de configuracao do grupo — que mostra os
    // nomes sem jamais abrir o conteudo. Spec 03 secao 9.
    if (!podeVerLista(carregado.actor, recurso)) throw new AppError('not_found')

    exigePrivado(carregado.channel)

    return db.select({
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      addedAt: channelMembers.addedAt,
    })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(asc(channelMembers.addedAt))
  })

  app.post('/api/channels/:id/members', { preHandler: requireAuth }, async (req, reply) => {
    const channelId = uuidOu404((req.params as { id: string }).id)
    const carregado = await loadChannelActor(req.user!.id, channelId)
    if (!carregado) throw new AppError('not_found')
    assertCan(carregado.actor, 'channel.manage_members', {
      kind: 'channel', visibility: carregado.channel.visibility,
    })

    exigePrivado(carregado.channel)

    const { userId: alvo } = parse(membroSchema, req.body)
    await membroDoGrupoOu404(carregado.channel.groupId, alvo)

    // Adicionar duas vezes e a mesma intencao com o mesmo resultado; o segundo
    // pedido nao merece um 409.
    await db.insert(channelMembers)
      .values({ channelId, userId: alvo, addedBy: req.user!.id })
      .onConflictDoNothing()

    // So para quem foi adicionado: o canal aparece na barra lateral dele na
    // hora, e continua invisivel para todo o resto do grupo.
    emit.toUser(alvo, { t: 'channel.created', d: serializeChannel(carregado.channel) })

    return reply.status(201).send({ userId: alvo, channelId })
  })

  app.delete('/api/channels/:id/members/:userId', { preHandler: requireAuth },
    async (req, reply) => {
      const p = req.params as { id: string; userId: string }
      const channelId = uuidOu404(p.id)
      const alvo = uuidOu404(p.userId)
      const eu = req.user!.id

      const carregado = await loadChannelActor(eu, channelId)
      if (!carregado) throw new AppError('not_found')
      const recurso = { kind: 'channel' as const, visibility: carregado.channel.visibility }
      // Sair e direito de quem participa; tirar outra pessoa exige administrar.
      assertCan(carregado.actor, alvo === eu ? 'channel.read' : 'channel.manage_members', recurso)

      exigePrivado(carregado.channel)

      await db.delete(channelMembers).where(and(
        eq(channelMembers.channelId, channelId), eq(channelMembers.userId, alvo),
      ))

      // Espelho da adicao: o canal some da barra lateral de quem saiu, e o
      // cliente descarta da memoria as mensagens que ele nao pode mais ver.
      emit.toUser(alvo, {
        t: 'channel.deleted', d: { id: channelId, groupId: carregado.channel.groupId },
      })
      return reply.status(204).send()
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

    // Capturar a audiencia antes de apagar: depois do DELETE o canal nao
    // existe, e perguntar quem o via devolveria lista vazia.
    const audiencia = await audienceOfChannel(channelId)

    // Mensagens e lista de acesso caem por ON DELETE CASCADE.
    await db.delete(channels).where(eq(channels.id, channelId))

    emit.toUsers(audiencia, {
      t: 'channel.deleted', d: { id: channelId, groupId: carregado.channel.groupId },
    })
    return reply.status(204).send()
  })
}
