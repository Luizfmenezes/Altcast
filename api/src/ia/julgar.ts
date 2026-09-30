import { perguntar, type Pergunta, type Respostas } from './cliente.js'
import {
  guardarNoCache, hashDe, lerDoCache, podeGastar, registrarDecisao, registrarGasto, type Recurso,
} from './memoria.js'

/**
 * A API interna da camada de IA: as rotas chamam `julgar.*`, e nada fora de
 * `src/ia/` conhece HTTP, cache, orcamento ou registro (decisao D12-B).
 *
 * Cada chamada passa pelo mesmo funil — orcamento, cache, cliente, registro —
 * e devolve `null` sempre que o caminho sem IA deve seguir: sem chave, circuito
 * aberto, orcamento estourado, prazo vencido.
 */

type Pedido = {
  groupId: string
  recurso: Recurso
  versao: string
  estado: unknown
  perguntas: Record<string, Pergunta>
  prazoMs: number
}

async function funil(p: Pedido): Promise<{ respostas: Respostas; hash: string; latenciaMs: number } | null> {
  const hash = hashDe(p.versao, p.estado, p.perguntas)
  const doCache = lerDoCache(hash)
  if (doCache !== null) return { respostas: doCache, hash, latenciaMs: 0 }

  const quantas = Object.keys(p.perguntas).length
  if (!podeGastar(p.groupId, quantas)) {
    await registrarDecisao({
      groupId: p.groupId, recurso: p.recurso, versao: p.versao, entradaHash: hash,
      respostas: null, latenciaMs: null, acao: 'orcamento_estourado',
    })
    return null
  }

  const r = await perguntar(p.estado, p.perguntas, p.prazoMs)
  if (r === null) {
    await registrarDecisao({
      groupId: p.groupId, recurso: p.recurso, versao: p.versao, entradaHash: hash,
      respostas: null, latenciaMs: null, acao: 'sem_resposta',
    })
    return null
  }
  registrarGasto(p.groupId, quantas)
  guardarNoCache(hash, r.respostas)
  return { respostas: r.respostas, hash, latenciaMs: r.latenciaMs }
}

export type Julgamento = {
  respostas: Respostas
  /** Para o chamador registrar a acao que tomou com o resultado. */
  registrar: (acao: string) => Promise<void>
}

/** Pergunta e devolve as respostas mais um registrador da acao tomada. */
export async function julgar(p: Pedido): Promise<Julgamento | null> {
  const r = await funil(p)
  if (r === null) return null
  return {
    respostas: r.respostas,
    registrar: acao => registrarDecisao({
      groupId: p.groupId, recurso: p.recurso, versao: p.versao, entradaHash: r.hash,
      respostas: r.respostas, latenciaMs: r.latenciaMs, acao,
    }),
  }
}

/** Le uma Score com seguranca: resposta ausente ou de outro tipo vira nulo. */
export function lerScore(respostas: Respostas, id: string): { score: number; confianca: number } | null {
  const r = respostas[id]
  if (r === undefined || r.type !== 'score') return null
  return { score: r.score, confianca: r.confidence }
}

export function lerNoul(respostas: Respostas, id: string): number | null {
  const r = respostas[id]
  return r !== undefined && r.type === 'noul' ? r.noul : null
}

export function lerChoice(respostas: Respostas, id: string): { escolha: string; confianca: number } | null {
  const r = respostas[id]
  if (r === undefined || r.type !== 'choice') return null
  return { escolha: r.choice, confianca: r.confidence }
}
