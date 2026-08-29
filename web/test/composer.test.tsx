import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from '../src/features/messages/Composer.js'
import { MessageList } from '../src/features/messages/MessageList.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const CANAL = 'c1'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'member' }],
  channels: [{
    id: CANAL, groupId: 'g1', name: 'geral', type: 'text',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [{
    groupId: 'g1', userId: 'u1', displayName: 'Felipe',
    avatarUrl: null, role: 'member', status: 'online',
  }],
  serverTime: '2026-08-29T12:00:00.000Z',
}

/** Composer e lista juntos: o eco so faz sentido se aparecer na conversa. */
function Conversa({ aoDigitar }: { aoDigitar?: () => void } = {}) {
  return (
    <>
      <MessageList escrevendo={false} />
      <Composer campo={{ current: null }} {...(aoDigitar ? { aoDigitar } : {})} />
    </>
  )
}

function respostaDoServidor(corpo: unknown, status = 201): Response {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'content-type': 'application/json' },
  })
}

describe('composicao', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    useStore.getState().escolherCanal(CANAL)
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('a mensagem aparece antes da resposta do servidor', async () => {
    // Resposta que nunca chega: o que estiver na tela veio do eco, e nao dela.
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined))
    const usuario = userEvent.setup()
    render(<Conversa />)

    await usuario.type(screen.getByLabelText('Escrever mensagem'), 'ola{Enter}')

    expect(screen.getByText('ola')).toBeInTheDocument()
    expect(screen.getByText('ola').closest('article')).toHaveAttribute('aria-busy', 'true')
  })

  it('usa o mesmo UUIDv7 do cliente e nao duplica quando o evento volta', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, opcoes) => {
      const corpo = JSON.parse(String((opcoes as RequestInit).body)) as { id: string }
      return respostaDoServidor({
        id: corpo.id, channelId: CANAL, authorId: 'u1', content: 'ola',
        createdAt: '2026-08-29T12:00:00.000Z', editedAt: null,
      })
    })
    const usuario = userEvent.setup()
    render(<Conversa />)

    await usuario.type(screen.getByLabelText('Escrever mensagem'), 'ola{Enter}')
    await vi.waitFor(() => expect(
      screen.getByText('ola').closest('article'),
    ).not.toHaveAttribute('aria-busy'))

    const id = useStore.getState().mensagens[CANAL]![0]!.id
    // O socket entrega a mesma mensagem que o POST ja confirmou. Reconciliar
    // pelo ID - e nao pelo texto - e o que impede duas linhas iguais.
    act(() => useStore.getState().aplicarEvento({
      t: 'message.created',
      d: {
        id, channelId: CANAL, authorId: 'u1', content: 'ola',
        createdAt: '2026-08-29T12:00:00.000Z', editedAt: null,
      },
    }))

    expect(screen.getAllByText('ola')).toHaveLength(1)
    expect(useStore.getState().mensagens[CANAL]).toHaveLength(1)
  })

  it('mensagem repetida nao e confundida com a anterior', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, opcoes) => {
      const corpo = JSON.parse(String((opcoes as RequestInit).body)) as
        { id: string; content: string }
      return respostaDoServidor({
        id: corpo.id, channelId: CANAL, authorId: 'u1', content: corpo.content,
        createdAt: '2026-08-29T12:00:00.000Z', editedAt: null,
      })
    })
    const usuario = userEvent.setup()
    render(<Conversa />)

    const campo = screen.getByLabelText('Escrever mensagem')
    await usuario.type(campo, 'oi{Enter}')
    await usuario.type(campo, 'oi{Enter}')

    // Reconciliar por conteudo apagaria a segunda; sao duas falas de verdade.
    await vi.waitFor(() => expect(screen.getAllByText('oi')).toHaveLength(2))
  })

  it('falha vira estado visivel com botao de tentar de novo', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoServidor({
      error: { code: 'internal_error', message: 'Algo deu errado.', requestId: 'r' },
    }, 500))
    const usuario = userEvent.setup()
    render(<Conversa />)

    await usuario.type(screen.getByLabelText('Escrever mensagem'), 'vai falhar{Enter}')

    expect(await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 5000 }))
      .toBeInTheDocument()
  })

  it('NUNCA some em silencio: o texto continua na tela apos o erro', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoServidor({
      error: { code: 'internal_error', message: 'Algo deu errado.', requestId: 'r' },
    }, 500))
    const usuario = userEvent.setup()
    render(<Conversa />)

    await usuario.type(screen.getByLabelText('Escrever mensagem'), 'nao me perca{Enter}')

    // A falha mais corrosiva de confianca num chat: a pessoa acha que falou, e
    // ninguem recebeu.
    await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 5000 })
    expect(screen.getByText('nao me perca')).toBeInTheDocument()
  })

  it('tentar de novo reenvia com o mesmo ID', async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoServidor({
      error: { code: 'internal_error', message: 'Algo deu errado.', requestId: 'r' },
    }, 500))
    const usuario = userEvent.setup()
    render(<Conversa />)

    await usuario.type(screen.getByLabelText('Escrever mensagem'), 'segunda chance{Enter}')
    const botao = await screen.findByRole(
      'button', { name: 'Tentar de novo' }, { timeout: 5000 },
    )

    const idAntes = useStore.getState().mensagens[CANAL]![0]!.id
    vi.mocked(fetch).mockResolvedValue(respostaDoServidor({
      id: idAntes, channelId: CANAL, authorId: 'u1', content: 'segunda chance',
      createdAt: '2026-08-29T12:00:00.000Z', editedAt: null,
    }))
    await usuario.click(botao)

    // O mesmo ID: reenviar com ID novo criaria duas mensagens se a primeira
    // tentativa tiver chegado ao servidor mesmo com a resposta perdida.
    await vi.waitFor(() => expect(useStore.getState().mensagens[CANAL]![0]!.envio)
      .toBeUndefined())
    expect(useStore.getState().mensagens[CANAL]![0]!.id).toBe(idAntes)
  })

  it('Enter envia, Shift+Enter quebra linha', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined))
    const usuario = userEvent.setup()
    render(<Conversa />)

    const campo = screen.getByLabelText('Escrever mensagem')
    await usuario.type(campo, 'primeira{Shift>}{Enter}{/Shift}segunda')
    expect(campo).toHaveValue('primeira\nsegunda')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()

    await usuario.type(campo, '{Enter}')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('recusa acima de 4000 caracteres e mostra o contador', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined))
    const usuario = userEvent.setup()
    render(<Conversa />)

    const campo = screen.getByLabelText('Escrever mensagem')
    await usuario.click(campo)
    await usuario.paste('x'.repeat(4001))

    // O contador so aparece perto do limite: mostra-lo sempre seria ruido em
    // 99% das mensagens.
    expect(screen.getByText(/4001\s*\/\s*4000/)).toBeInTheDocument()
    await usuario.type(campo, '{Enter}')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('emite typing no maximo a cada 3 segundos', async () => {
    const aoDigitar = vi.fn()
    // Relogio controlado em vez de timers falsos: o estrangulamento le
    // Date.now() diretamente, e o userEvent nao precisa disputar a fila de
    // tarefas com o vitest para que o teste seja deterministico.
    let agora = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => agora)

    const usuario = userEvent.setup()
    render(<Conversa aoDigitar={aoDigitar} />)

    const campo = screen.getByLabelText('Escrever mensagem')
    await usuario.type(campo, 'abc')
    // Tres teclas, um unico evento: e esse o ponto do estrangulamento.
    expect(aoDigitar).toHaveBeenCalledTimes(1)

    agora += 3100
    await usuario.type(campo, 'def')
    expect(aoDigitar).toHaveBeenCalledTimes(2)
  })
})
