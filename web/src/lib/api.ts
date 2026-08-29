/**
 * Cliente REST tipado.
 *
 * O cliente decide comportamento pelo `code`, nunca pelo texto da mensagem:
 * mudar a redacao de um erro no servidor jamais pode quebrar a interface.
 */

/** Espelha o envelope da spec 06. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | null
  readonly details: unknown

  constructor(args: {
    code: string; message: string; status: number
    requestId?: string | null; details?: unknown
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.code = args.code
    this.status = args.status
    this.requestId = args.requestId ?? null
    this.details = args.details ?? null
  }

  /** Mapa campo -> mensagens, quando o servidor mandou `details` de validacao. */
  get camposInvalidos(): Record<string, string[]> {
    const d = this.details
    return d !== null && typeof d === 'object' ? d as Record<string, string[]> : {}
  }
}

/** Emitido no `window` quando a sessao morre, para a aplicacao voltar ao login. */
export const SESSAO_EXPIROU = 'altcast:sessao-expirou'

const TENTATIVAS = 3
const ESPERA_BASE_MS = 300

type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE'

let jaAvisouSessao = false

/**
 * Duas requisicoes falhando ao mesmo tempo nao podem empilhar dois avisos de
 * sessao expirada na tela. O primeiro 401 avisa; os seguintes so falham.
 */
function avisarSessaoExpirada(): void {
  if (jaAvisouSessao) return
  jaAvisouSessao = true
  window.dispatchEvent(new Event(SESSAO_EXPIROU))
}

/** Chamado depois de um login bem-sucedido, para o proximo 401 voltar a avisar. */
export function rearmarAvisoDeSessao(): void {
  jaAvisouSessao = false
}

const dormir = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * 5xx e falha de rede sao transitorios e merecem nova tentativa. 4xx nao:
 * repetir um 422 reenviaria dado invalido tres vezes e poderia duplicar efeito
 * numa rota que nao e idempotente.
 */
function valeRepetir(status: number | null): boolean {
  return status === null || status >= 500
}

async function lerEnvelope(res: Response): Promise<ApiError> {
  let corpo: unknown = null
  try {
    corpo = await res.json()
  } catch {
    // Resposta sem JSON — proxy no caminho, HTML de erro, corpo vazio.
  }
  const envelope = (corpo as { error?: Record<string, unknown> } | null)?.error
  return new ApiError({
    code: typeof envelope?.code === 'string' ? envelope.code : 'internal_error',
    message: typeof envelope?.message === 'string'
      ? envelope.message
      : 'Algo deu errado. Tente novamente.',
    status: res.status,
    requestId: typeof envelope?.requestId === 'string' ? envelope.requestId : null,
    details: envelope?.details ?? null,
  })
}

async function requisitar<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
  let ultimoErro: ApiError | null = null

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    let res: Response
    try {
      res = await fetch(`/api${caminho}`, {
        method: metodo,
        // Sem isto o cookie de sessao nao acompanha a requisicao e toda
        // chamada autenticada volta 401.
        credentials: 'include',
        headers: corpo === undefined ? {} : { 'content-type': 'application/json' },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      })
    } catch {
      // Rede caiu, DNS falhou, aba offline: nao houve resposta nenhuma.
      ultimoErro = new ApiError({
        code: 'network_error',
        message: 'Sem conexao com o servidor. Verifique sua rede.',
        status: 0,
      })
      if (tentativa < TENTATIVAS) await dormir(ESPERA_BASE_MS * 2 ** (tentativa - 1))
      continue
    }

    if (res.ok) {
      // 204 nao tem corpo; tentar interpretar como JSON estouraria.
      if (res.status === 204) return null as T
      return await res.json() as T
    }

    if (res.status === 401) avisarSessaoExpirada()

    ultimoErro = await lerEnvelope(res)
    if (!valeRepetir(res.status)) throw ultimoErro
    if (tentativa < TENTATIVAS) await dormir(ESPERA_BASE_MS * 2 ** (tentativa - 1))
  }

  throw ultimoErro!
}

export const api = {
  get: <T>(caminho: string): Promise<T> => requisitar<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown): Promise<T> =>
    requisitar<T>('POST', caminho, corpo ?? {}),
  patch: <T>(caminho: string, corpo: unknown): Promise<T> =>
    requisitar<T>('PATCH', caminho, corpo),
  delete: <T>(caminho: string): Promise<T> => requisitar<T>('DELETE', caminho),
}
