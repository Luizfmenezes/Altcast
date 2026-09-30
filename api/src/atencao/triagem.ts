import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { groupMembers, messages, notificationPrefs } from '../db/schema.js'
import { audienceOfChannel } from '../realtime/fanout.js'
import { emit } from '../realtime/emit.js'
import { julgar, lerScore } from '../ia/julgar.js'
import { recursoLigado } from '../ia/memoria.js'
import { LIMIAR_ATENCAO, VERSAO_ATENCAO, perguntaDeAtencao } from '../ia/perguntas/atencao.v1.js'
import { logger } from '../shared/logger.js'

/**
 * Triagem de notificacao — o nivel "Inteligente" (Etapa 2.10, secao 7.3).
 *
 * Roda DEPOIS de a mensagem estar publicada e distribuida, sem ninguem
 * esperar: e um aviso a mais, e nunca um atraso. So para quem escolheu o nivel
 * `smart` num canal com o recurso ligado pelo grupo — e so sobre quem nao foi
 * mencionado, porque mencao ja notifica pela regra do codigo.
 *
 * Os dados que saem sao os minimos: o texto da mensagem, as ultimas cinco do
 * canal com os autores trocados por apelidos estaveis ("autor", "pessoa_1"),
 * o nome e o assunto do canal. Nenhum e-mail, nenhum id, nenhum nome de
 * pessoa. Canal privado so com o grupo tendo ligado isso explicitamente.
 */

const CONTEXTO = 5
const GRUPO_GRANDE = 50
const PRAZO_MS = 3000

type Publicada = {
  id: string
  channelId: string
  authorId: string
  content: string
  mentionsEveryone: boolean
  mencionados: string[]
}

type CanalDaMensagem = { groupId: string; visibility: 'public' | 'private'; name: string; topic: string | null }

/** Quem, nesta audiencia, escolheu "Inteligente" e nao esta silenciado aqui. */
async function leitoresInteligentes(
  canal: CanalDaMensagem & { id: string }, candidatos: string[], agora: Date,
): Promise<string[]> {
  if (candidatos.length === 0) return []
  const prefs = await db.select().from(notificationPrefs).where(and(
    inArray(notificationPrefs.userId, candidatos),
    or(
      eq(notificationPrefs.channelId, canal.id),
      and(eq(notificationPrefs.groupId, canal.groupId), isNull(notificationPrefs.channelId)),
    ),
  ))
  const total = await db.$count(groupMembers, eq(groupMembers.groupId, canal.groupId))
  const padrao = total > GRUPO_GRANDE ? 'mentions' : 'all'

  return candidatos.filter(userId => {
    const doCanal = prefs.find(p => p.userId === userId && p.channelId === canal.id)
    const doGrupo = prefs.find(p => p.userId === userId && p.channelId === null)
    const silenciado = [doCanal, doGrupo].some(p => p?.mutedUntil != null && p.mutedUntil > agora)
    if (silenciado) return false
    return (doCanal?.level ?? doGrupo?.level ?? padrao) === 'smart'
  })
}

export async function triarAtencao(mensagem: Publicada, canal: CanalDaMensagem): Promise<void> {
  try {
    // `@todos` ja notifica todo mundo; nao ha o que triar.
    if (mensagem.mentionsEveryone) return
    const config = await recursoLigado(canal.groupId, 'triagem')
    if (!config.ativo) return
    if (canal.visibility === 'private' && !config.incluiPrivados) return

    const agora = new Date()
    const audiencia = (await audienceOfChannel(mensagem.channelId))
      .filter(u => u !== mensagem.authorId && !mensagem.mencionados.includes(u))
    const leitores = await leitoresInteligentes({ ...canal, id: mensagem.channelId }, audiencia, agora)
    if (leitores.length === 0) return

    const anteriores = await db.select({ authorId: messages.authorId, content: messages.content })
      .from(messages)
      .where(and(
        eq(messages.channelId, mensagem.channelId),
        isNull(messages.deletedAt),
        lt(messages.id, mensagem.id),
      ))
      .orderBy(desc(messages.id))
      .limit(CONTEXTO)

    // Apelidos estaveis por conversa: o mesmo autor e sempre o mesmo apelido
    // dentro deste estado, e nenhum identificador real sai daqui.
    const apelidos = new Map<string, string>([[mensagem.authorId, 'autor']])
    const apelidoDe = (id: string | null): string => {
      if (id === null) return 'removido'
      if (!apelidos.has(id)) apelidos.set(id, `pessoa_${String(apelidos.size)}`)
      return apelidos.get(id)!
    }
    const participantes = new Set(anteriores.map(a => a.authorId).filter((a): a is string => a !== null))

    const estado = {
      message: { author: 'autor', text: mensagem.content },
      recent_context: [...anteriores].reverse().map(a => ({ author: apelidoDe(a.authorId), text: a.content })),
      channel: { name: canal.name, topic: canal.topic ?? '' },
    }

    const ativos = leitores.filter(u => participantes.has(u))
    const quietos = leitores.filter(u => !participantes.has(u))
    const perguntas = {
      ...(ativos.length > 0 ? { participou: perguntaDeAtencao(true) } : {}),
      ...(quietos.length > 0 ? { ausente: perguntaDeAtencao(false) } : {}),
    }

    const r = await julgar({
      groupId: canal.groupId, recurso: 'triagem', versao: VERSAO_ATENCAO,
      estado, perguntas, prazoMs: PRAZO_MS,
    })
    if (r === null) return

    const limiar = {
      score: Number(config.limiar['score'] ?? LIMIAR_ATENCAO.score),
      confianca: Number(config.limiar['confianca'] ?? LIMIAR_ATENCAO.confianca),
    }
    const avisados: string[] = []
    for (const [id, grupo] of [['participou', ativos], ['ausente', quietos]] as const) {
      const s = lerScore(r.respostas, id)
      if (s === null || grupo.length === 0) continue
      if (s.score >= limiar.score && s.confianca >= limiar.confianca) avisados.push(...grupo)
    }
    if (avisados.length > 0) {
      emit.toUsers(avisados, {
        t: 'attention.suggested',
        d: { channelId: mensagem.channelId, messageId: mensagem.id },
      })
    }
    await r.registrar(avisados.length > 0 ? `notificou:${String(avisados.length)}` : 'abaixo_do_limiar')
  } catch (erro) {
    // Triagem e um aviso a mais. Falhar aqui nunca pode subir para a rota.
    logger.warn({ erro: String(erro) }, 'triagem de atencao falhou')
  }
}
