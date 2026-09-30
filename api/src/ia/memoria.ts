import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { groupAiSettings, iaDecisoes } from '../db/schema.js'
import { env } from '../env.js'
import { newId } from '../shared/ids.js'
import { logger } from '../shared/logger.js'
import type { Respostas } from './cliente.js'

/**
 * O que a camada de IA lembra: cache, orcamento, configuracao do grupo e o
 * registro de cada decisao.
 */

export type Recurso = 'triagem' | 'automod' | 'rerank' | 'ja_respondida' | 'denuncias' | 'cargos' | 'sugestoes'

/** Hash estavel da entrada — chave do cache e do registro. */
export function hashDe(versao: string, estado: unknown, perguntas: unknown): string {
  return createHash('sha256').update(JSON.stringify([versao, estado, perguntas])).digest('hex')
}

// --- cache: LRU em memoria, 10 minutos -------------------------------------
//
// A mesma pergunta sobre o mesmo estado da a mesma resposta: um leitor que
// abre duas abas, ou dois leitores com o mesmo perfil, nao pagam duas vezes.
// Em memoria por processo; com Redis (Etapa 7) passa a ser compartilhado.

const TTL_MS = 10 * 60_000
const MAXIMO = 1000
const cache = new Map<string, { respostas: Respostas; ate: number }>()

export function lerDoCache(chave: string, agora: number = Date.now()): Respostas | null {
  const achado = cache.get(chave)
  if (achado === undefined) return null
  if (achado.ate < agora) { cache.delete(chave); return null }
  // Reinsere para o fim: e o que faz o Map funcionar como LRU.
  cache.delete(chave)
  cache.set(chave, achado)
  return achado.respostas
}

export function guardarNoCache(chave: string, respostas: Respostas, agora: number = Date.now()): void {
  cache.set(chave, { respostas, ate: agora + TTL_MS })
  while (cache.size > MAXIMO) cache.delete(cache.keys().next().value!)
}

// --- orcamento: teto de julgamentos por grupo por dia -----------------------
//
// Acima do teto o recurso degrada para o caminho sem IA, e isso e registrado:
// um grupo que estoura todo dia e um grupo cujo limiar ou cujo uso precisa de
// revisao — nao uma fatura surpresa.

const gasto = new Map<string, { dia: string; n: number }>()
let tetoInjetado: number | undefined

/** So para teste: troca o teto diario. `undefined` volta ao ambiente. */
export function definirOrcamentoParaTeste(teto: number | undefined): void {
  tetoInjetado = teto
}

const hoje = (agora: Date = new Date()): string => agora.toISOString().slice(0, 10)

export function podeGastar(groupId: string, quantas = 1, agora: Date = new Date()): boolean {
  const atual = gasto.get(groupId)
  const usadas = atual?.dia === hoje(agora) ? atual.n : 0
  return usadas + quantas <= (tetoInjetado ?? env.IA_ORCAMENTO_DIARIO)
}

export function registrarGasto(groupId: string, quantas = 1, agora: Date = new Date()): void {
  const atual = gasto.get(groupId)
  const dia = hoje(agora)
  gasto.set(groupId, { dia, n: (atual?.dia === dia ? atual.n : 0) + quantas })
}

/** So para teste. */
export function zerarMemoriaParaTeste(): void {
  cache.clear()
  gasto.clear()
}

// --- configuracao por grupo ---------------------------------------------------

export async function recursoLigado(
  groupId: string, recurso: Recurso,
): Promise<{ ativo: boolean; incluiPrivados: boolean; limiar: Record<string, unknown> }> {
  const [linha] = await db.select().from(groupAiSettings)
    .where(and(eq(groupAiSettings.groupId, groupId), eq(groupAiSettings.recurso, recurso)))
    .limit(1)
  return {
    ativo: linha?.ativo ?? false,
    incluiPrivados: linha?.incluiPrivados ?? false,
    limiar: (linha?.limiar ?? {}) as Record<string, unknown>,
  }
}

// --- registro de decisoes ------------------------------------------------------

export async function registrarDecisao(d: {
  groupId: string | null
  recurso: Recurso
  versao: string
  entradaHash: string
  respostas: Respostas | null
  latenciaMs: number | null
  acao: string
}): Promise<void> {
  try {
    await db.insert(iaDecisoes).values({
      id: newId(),
      groupId: d.groupId,
      recurso: d.recurso,
      versao: d.versao,
      entradaHash: d.entradaHash,
      resposta: d.respostas,
      latenciaMs: d.latenciaMs,
      acao: d.acao,
    })
  } catch (erro) {
    // O registro e para calibrar; perde-lo nao pode derrubar o recurso.
    logger.warn({ erro: String(erro) }, 'ia: falha ao registrar decisao')
  }
}
