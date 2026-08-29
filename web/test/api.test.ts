import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, api, SESSAO_EXPIROU } from '../src/lib/api.js'

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'content-type': 'application/json' },
  })
}

const envelope = (code: string) => ({
  error: { code, message: 'texto que o cliente jamais interpreta', requestId: 'r1', details: null },
})

describe('cliente REST', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** As esperas entre tentativas rodam em timers falsos; avanca todas de uma vez. */
  async function correr<T>(promessa: Promise<T>): Promise<T> {
    const resultado = promessa.catch((e: unknown) => ({ __erro: e }) as never)
    await vi.runAllTimersAsync()
    const valor = await resultado
    if (valor && typeof valor === 'object' && '__erro' in valor) {
      throw (valor as { __erro: unknown }).__erro
    }
    return valor
  }

  it('converte o envelope de erro em ApiError com o code preservado', async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(410, envelope('invite_expired')))

    const erro = await correr(api.post('/invites/X/accept').catch((e: unknown) => e))
    expect(erro).toBeInstanceOf(ApiError)
    expect(erro).toMatchObject({ code: 'invite_expired', status: 410, requestId: 'r1' })
  })

  it('envia credenciais em toda requisicao', async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(200, { ok: true }))
    await correr(api.get('/auth/me'))

    const [, opcoes] = vi.mocked(fetch).mock.calls[0]!
    // Sem isto o cookie de sessao nao acompanha a requisicao e toda chamada
    // autenticada volta 401.
    expect(opcoes).toMatchObject({ credentials: 'include' })
  })

  it('repete automaticamente em falha de rede, ate 3 tentativas', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockResolvedValue(resposta(200, { ok: true }))

    await expect(correr(api.get('/groups'))).resolves.toEqual({ ok: true })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('desiste depois da terceira tentativa e informa a falha de rede', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('failed to fetch'))

    const erro = await correr(api.get('/groups').catch((e: unknown) => e))
    expect(erro).toMatchObject({ code: 'network_error' })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it('NAO repete em 4xx', async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(422, envelope('validation_failed')))

    await correr(api.post('/groups', { name: '' }).catch(() => null))
    // Repetir um 422 reenviaria dado invalido tres vezes e poderia duplicar
    // efeito em rota nao idempotente.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('repete em 5xx, porque o servidor pode ter tropecado uma vez so', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(resposta(500, envelope('internal_error')))
      .mockResolvedValue(resposta(200, { ok: true }))

    await expect(correr(api.get('/groups'))).resolves.toEqual({ ok: true })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('em 401 dispara o evento de sessao expirada uma unica vez', async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(401, envelope('unauthenticated')))
    const ouvinte = vi.fn()
    window.addEventListener(SESSAO_EXPIROU, ouvinte)

    await correr(api.get('/auth/me').catch(() => null))
    await correr(api.get('/groups').catch(() => null))

    // Duas requisicoes falhando ao mesmo tempo nao podem empilhar dois avisos
    // de sessao expirada na tela.
    expect(ouvinte).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSAO_EXPIROU, ouvinte)
  })

  it('204 devolve nulo em vez de estourar no parse', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(correr(api.delete('/groups/1'))).resolves.toBeNull()
  })

  it('prefixa /api e serializa o corpo como JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(resposta(201, { id: 'g1' }))
    await correr(api.post('/groups', { name: 'Time' }))

    const [url, opcoes] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/groups')
    expect(opcoes).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'Time' }) })
  })
})
