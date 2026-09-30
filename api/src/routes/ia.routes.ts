import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { groupAiSettings } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { circuitoAberto, iaDisponivel } from '../ia/cliente.js'
import { emit } from '../realtime/emit.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * O que cada grupo ligou da camada de IA (regra 1 da secao 7.1: opt-in por
 * grupo, por recurso, tudo desligado por padrao).
 *
 * Qualquer membro LE — saber que as mensagens do grupo passam por uma triagem
 * automatica e direito de quem escreve nelas. So quem pode editar o grupo
 * (`group.update`) liga ou desliga.
 */

const RECURSOS = ['triagem', 'automod', 'rerank', 'ja_respondida', 'denuncias', 'cargos', 'sugestoes'] as const

const alterarSchema = z.object({
  ativo: z.boolean(),
  incluiPrivados: z.boolean().optional(),
})

export async function iaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups/:id/ai', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const ator = await loadGroupActor(req.user!.id, groupId)
    if (ator.permissoes === null) throw new AppError('not_found')

    const linhas = await db.select().from(groupAiSettings).where(eq(groupAiSettings.groupId, groupId))
    return {
      // Sem chave no servidor, a aba mostra tudo como indisponivel: a
      // configuracao do grupo continua guardada para quando houver.
      disponivel: iaDisponivel(),
      foraDoAr: circuitoAberto(),
      recursos: RECURSOS.map(recurso => {
        const l = linhas.find(x => x.recurso === recurso)
        return { recurso, ativo: l?.ativo ?? false, incluiPrivados: l?.incluiPrivados ?? false }
      }),
    }
  })

  app.put('/api/groups/:id/ai/:recurso', { preHandler: requireAuth }, async req => {
    const params = req.params as { id: string; recurso: string }
    const groupId = uuidOu404(params.id)
    const recurso = RECURSOS.find(r => r === params.recurso)
    if (recurso === undefined) throw new AppError('not_found')
    const ator = await loadGroupActor(req.user!.id, groupId)
    assertCan(ator, 'group.update', { kind: 'group' })
    const dados = parse(alterarSchema, req.body)

    const valores = {
      ativo: dados.ativo,
      ...(dados.incluiPrivados === undefined ? {} : { incluiPrivados: dados.incluiPrivados }),
      updatedBy: req.user!.id,
      updatedAt: new Date(),
    }
    const [linha] = await db.insert(groupAiSettings)
      .values({ groupId, recurso, ...valores })
      .onConflictDoUpdate({ target: [groupAiSettings.groupId, groupAiSettings.recurso], set: valores })
      .returning()

    const resposta = { recurso, ativo: linha!.ativo, incluiPrivados: linha!.incluiPrivados }
    // O grupo inteiro fica sabendo: a aba IA de todos mostra o estado novo.
    await emit.toGroup(groupId, { t: 'group.ai_updated', d: { groupId, ...resposta } })
    return resposta
  })
}
