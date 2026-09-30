import { env } from '../env.js'
import { logger } from '../shared/logger.js'

/**
 * O cliente do System One (TypeSafe, modelo Jev) — o unico lugar que fala com
 * a API. Contrato em https://docs.typesafe.ai/api (lido em 2026-09-26):
 * `POST /v1/systemone` com `{ model, state, questions }`, resposta
 * `{ answers: { [id]: { type, noul | choice | score, probabilities, confidence } } }`.
 *
 * Tres protecoes, porque TODO recurso de IA do Altcast tem caminho sem IA e a
 * conversa nunca pode esperar por um julgamento:
 *
 * - prazo por chamada (o chamador escolhe; o automod sincrono usa 800 ms);
 * - retentativa com recuo exponencial em 429 e 529, no maximo duas, e so se o
 *   prazo ainda comportar;
 * - disjuntor: cinco falhas em trinta segundos abrem o circuito por sessenta,
 *   e nesse tempo ninguem espera uma API que ja se sabe fora do ar.
 *
 * Falha nunca vira excecao para quem chama: vira `null`, e `null` e o sinal
 * para seguir o caminho sem IA.
 */

export type Pergunta =
  | { type: 'noul'; instructions: unknown; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, string> }
  | { type: 'score'; instructions: unknown; criteria: string[] }

export type Resposta =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }

export type Respostas = Record<string, Resposta>

type Transporte = (url: string, init: RequestInit) => Promise<Response>

let transporte: Transporte = (url, init) => fetch(url, init)

/** So para teste: troca o `fetch` por um duble. */
export function definirTransporteParaTeste(t: Transporte | null): void {
  transporte = t ?? ((url, init) => fetch(url, init))
  disjuntor.falhas = []
  disjuntor.abertoAte = 0
}

const disjuntor = { falhas: [] as number[], abertoAte: 0 }
const JANELA_DO_DISJUNTOR_MS = 30_000
const FALHAS_PARA_ABRIR = 5
const ABERTO_POR_MS = 60_000

function registrarFalha(agora: number): void {
  disjuntor.falhas = [...disjuntor.falhas.filter(t => agora - t < JANELA_DO_DISJUNTOR_MS), agora]
  if (disjuntor.falhas.length >= FALHAS_PARA_ABRIR) {
    disjuntor.abertoAte = agora + ABERTO_POR_MS
    disjuntor.falhas = []
    logger.warn('ia: disjuntor aberto por 60s depois de 5 falhas')
  }
}

/** `undefined`: vale o ambiente. Qualquer outro valor: o teste decidiu. */
let chaveInjetada: string | null | undefined

/** So para teste: finge uma chave (ou a ausencia dela). */
export function definirChaveParaTeste(chave: string | null | undefined): void {
  chaveInjetada = chave
}

function chave(): string | undefined {
  if (chaveInjetada !== undefined) return chaveInjetada ?? undefined
  return env.TYPESAFE_API_KEY
}

/** Ha chave configurada? Sem ela, todo recurso aparece como indisponivel. */
export function iaDisponivel(): boolean {
  const c = chave()
  return c !== undefined && c !== ''
}

export function circuitoAberto(agora: number = Date.now()): boolean {
  return disjuntor.abertoAte > agora
}

const dormir = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export async function perguntar(
  estado: unknown, perguntas: Record<string, Pergunta>, prazoMs: number,
): Promise<{ respostas: Respostas; latenciaMs: number } | null> {
  if (!iaDisponivel()) return null
  const inicio = Date.now()
  if (circuitoAberto(inicio)) return null

  const corpo = JSON.stringify({ model: env.TYPESAFE_MODEL, state: estado, questions: perguntas })
  for (let tentativa = 0; tentativa <= 2; tentativa++) {
    const restante = prazoMs - (Date.now() - inicio)
    if (restante <= 50) break
    const controle = new AbortController()
    const cronometro = setTimeout(() => { controle.abort() }, restante)
    try {
      const r = await transporte(env.TYPESAFE_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${chave() ?? ''}`,
          'content-type': 'application/json',
        },
        body: corpo,
        signal: controle.signal,
      })
      if (r.status === 429 || r.status === 529) {
        // Recuo exponencial curto: so tenta de novo se ainda couber no prazo.
        await dormir(Math.min(100 * 2 ** tentativa, Math.max(0, prazoMs - (Date.now() - inicio) - 50)))
        continue
      }
      if (!r.ok) {
        registrarFalha(Date.now())
        logger.warn({ status: r.status }, 'ia: resposta de erro do System One')
        return null
      }
      const dados = await r.json() as { answers?: Respostas }
      if (dados.answers === undefined) { registrarFalha(Date.now()); return null }
      return { respostas: dados.answers, latenciaMs: Date.now() - inicio }
    } catch {
      // Prazo estourado ou rede: falha, e o chamador segue sem IA.
      registrarFalha(Date.now())
      return null
    } finally {
      clearTimeout(cronometro)
    }
  }
  registrarFalha(Date.now())
  return null
}
