import { WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { registry } from '../../src/realtime/registry.js'
import { presence } from '../../src/realtime/presence.js'
import { calls } from '../../src/realtime/calls.js'
import { buildServer } from '../../src/index.js'

export type Frame = { t: string; d: Record<string, unknown> }

/**
 * Sobe o servidor numa porta livre e entrega a URL do gateway.
 *
 * O registro e a presenca vivem em memoria de modulo, compartilhada entre
 * testes: limpar ao final e o que impede um teste de herdar as conexoes do
 * anterior e ver eventos que nao pediu.
 */
export async function comServidor<T>(
  fn: (app: FastifyInstance, url: string) => Promise<T>,
): Promise<T> {
  const app = await buildServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const porta = (app.server.address() as { port: number }).port
  try {
    return await fn(app, `ws://127.0.0.1:${porta}/ws`)
  } finally {
    registry.clear()
    presence.clear()
    // `calls` faltava aqui, e a falta ja vazava salas de um teste para o
    // seguinte. Com a saida adiada isso deixa de ser so sujeira: um timer
    // sobrevivente dispararia no meio do proximo teste, tirando da chamada
    // alguem que acabou de entrar.
    calls.clear()
    await app.close()
  }
}

/** Resolve quando o socket abre; rejeita com o status quando o upgrade e negado. */
export function conectar(url: string, cookie?: string): Promise<WebSocket> {
  const ws = new WebSocket(url, cookie ? { headers: { cookie } } : {})
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)))
    ws.on('error', erro => reject(erro))
  })
}

export function primeiroFrame(ws: WebSocket): Promise<Frame> {
  return new Promise(resolve => {
    ws.once('message', dados => resolve(JSON.parse(dados.toString())))
  })
}

export function fechado(ws: WebSocket): Promise<void> {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) return resolve()
    ws.once('close', () => resolve())
  })
}

export const espere = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Escuta acumulando tudo o que chegar. Provar que um socket NAO recebeu algo
 * exige justamente isto: uma lista completa que se possa inspecionar depois.
 */
export function escutar(ws: WebSocket): Frame[] {
  const recebidos: Frame[] = []
  ws.on('message', dados => recebidos.push(JSON.parse(dados.toString())))
  return recebidos
}

/**
 * Espera ate o frame do tipo pedido aparecer, ou falha por tempo esgotado.
 *
 * ## Por que o orcamento e generoso
 *
 * Nenhuma espera daqui afirma LATENCIA — todas afirmam que algo chega, e os
 * casos que provam o contrario (que algo NAO chega) usam `espere()` com um
 * prazo proprio e filtram a lista, sem passar por aqui. Logo, um limite
 * apertado nao protege nada: ele so transforma maquina ocupada em suite
 * vermelha.
 *
 * E ocupada de verdade. O hook de pre-commit roda api, web e desktop, e um
 * dos casos de voz satura o servidor de proposito com um `setInterval` de 1ms
 * para provar que o `ready` vem primeiro mesmo com evento em voo. Com o
 * orcamento de 1s que havia aqui, dois casos falhavam de forma intermitente
 * dizendo "o quadro nao chegou" quando o quadro chegava — na ordem certa, so
 * mais tarde. Flaky de teste nao e defeito de produto, mas gasta a mesma
 * confianca, e o remedio certo e aqui, nao em cada chamada.
 */
export async function esperarFrame(
  recebidos: Frame[], tipo: string, limiteMs = 10_000,
): Promise<Frame> {
  const fim = Date.now() + limiteMs
  for (;;) {
    const achado = recebidos.find(f => f.t === tipo)
    if (achado) return achado
    if (Date.now() > fim) throw new Error(`frame '${tipo}' nao chegou em ${limiteMs}ms`)
    await espere(20)
  }
}

/**
 * Espera ate a condicao valer. Necessario quando o alvo nao e "chegou um frame
 * do tipo X" e sim uma leitura derivada da lista, que precisa ser recalculada a
 * cada tentativa em vez de fotografada uma vez.
 */
export async function ateQue(condicao: () => boolean, limiteMs = 10_000): Promise<void> {
  const fim = Date.now() + limiteMs
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`condicao nao ocorreu em ${limiteMs}ms`)
    await espere(20)
  }
}

/** Conecta, consome o `ready` e devolve o socket ja escutando o resto. */
export async function conectado(
  url: string, cookie: string,
): Promise<{ ws: WebSocket; frames: Frame[] }> {
  const ws = await conectar(url, cookie)
  await primeiroFrame(ws)
  return { ws, frames: escutar(ws) }
}

/**
 * Conecta SEM consumir o `ready` — o quadro entra na lista como qualquer outro.
 *
 * `conectado()` engole o primeiro quadro, que e sempre o `ready`; para um teste
 * que afirma algo SOBRE o `ready` isso e fatal, porque o quadro nunca aparece
 * em `frames` e a espera so pode terminar por tempo esgotado. O ouvinte entra
 * aqui antes de qualquer ida a rede, que e o mesmo pressuposto de
 * `primeiroFrame`: nada chegou ainda quando o socket acabou de abrir.
 */
export async function conectarEscutando(
  url: string, cookie: string,
): Promise<{ ws: WebSocket; frames: Frame[] }> {
  const ws = await conectar(url, cookie)
  return { ws, frames: escutar(ws) }
}
