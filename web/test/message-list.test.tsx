import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MessageList } from '../src/features/messages/MessageList.js'
import { useStore } from '../src/lib/store.js'
import type { Mensagem, Ready } from '../src/lib/tipos.js'

const CANAL = 'c1'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Anticorp', iconUrl: null, role: 'member' }],
  channels: [{
    id: CANAL, groupId: 'g1', name: 'geral', type: 'text',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [
    {
      groupId: 'g1', userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'member', status: 'online',
    },
    {
      groupId: 'g1', userId: 'u2', displayName: 'Ana',
      avatarUrl: null, role: 'admin', status: 'online',
    },
  ],
  serverTime: '2026-08-29T12:00:00.000Z',
}

/**
 * UUIDv7 sintetico com o tempo nos bits mais significativos: a ordenacao da
 * lista depende de o ID crescer junto com o relogio, entao o teste precisa de
 * IDs que respeitem isso.
 */
function idEm(instante: string, sufixo: number): string {
  const ms = new Date(instante).getTime().toString(16).padStart(12, '0')
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-${String(sufixo).padStart(12, '0')}`
}

function mensagem(instante: string, extras: Partial<Mensagem> = {}, sufixo = 1): Mensagem {
  return {
    id: idEm(instante, sufixo),
    channelId: CANAL,
    authorId: 'u2',
    content: 'conteudo',
    createdAt: instante,
    editedAt: null,
    ...extras,
  }
}

function chegar(...novas: Mensagem[]): void {
  act(() => {
    for (const m of novas) useStore.getState().aplicarEvento({ t: 'message.created', d: m })
  })
}

/** jsdom nao tem layout: a rolagem precisa ser descrita explicitamente. */
function rolarPara(log: HTMLElement, scrollTop: number): void {
  Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
  Object.defineProperty(log, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  act(() => log.dispatchEvent(new Event('scroll')))
}

describe('lista de mensagens', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    useStore.getState().escolherCanal(CANAL)
  })
  afterEach(() => vi.useRealTimers())

  it('e uma regiao de log educada', () => {
    render(<MessageList escrevendo={false} />)
    const log = screen.getByRole('log')
    expect(log).toHaveAttribute('aria-live', 'polite')
    // 'additions' e nao 'all': reler a lista inteira a cada mensagem seria
    // exatamente o comportamento que torna chat insuportavel no leitor de tela.
    expect(log).toHaveAttribute('aria-relevant', 'additions')
  })

  it('pausa os anuncios enquanto o campo de escrita esta focado', () => {
    const { rerender } = render(<MessageList escrevendo={false} />)
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite')

    rerender(<MessageList escrevendo />)
    // Interromper quem esta digitando e pior do que nao anunciar.
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
  })

  it('o indicador de digitacao NAO fica em regiao viva', () => {
    render(<MessageList escrevendo={false} digitando={['Ana']} />)
    const aviso = screen.getByText(/esta digitando/)
    // Informacao de baixo valor e altissima frequencia: anuncia-la seria ruido.
    expect(aviso.closest('[aria-live]')).toBeNull()
  })

  it('agrupa mensagens do mesmo autor em menos de 5 minutos', () => {
    chegar(
      mensagem('2026-08-29T12:00:00.000Z', { content: 'primeira' }, 1),
      mensagem('2026-08-29T12:02:00.000Z', { content: 'segunda' }, 2),
      mensagem('2026-08-29T12:30:00.000Z', { content: 'terceira' }, 3),
    )
    render(<MessageList escrevendo={false} />)

    // Tres mensagens, dois cabecalhos: a segunda herda o da primeira.
    expect(screen.getAllByText('Ana')).toHaveLength(2)
    expect(screen.getByText('primeira')).toBeInTheDocument()
    expect(screen.getByText('segunda')).toBeInTheDocument()
  })

  it('troca de autor sempre recomeca o cabecalho', () => {
    chegar(
      mensagem('2026-08-29T12:00:00.000Z', { content: 'da ana' }, 1),
      mensagem('2026-08-29T12:00:30.000Z', { authorId: 'u1', content: 'do felipe' }, 2),
    )
    render(<MessageList escrevendo={false} />)

    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Felipe')).toBeInTheDocument()
  })

  it('insere separador entre dias diferentes', () => {
    // Meio-dia UTC nos dois casos: o separador segue o dia LOCAL de quem le,
    // e um par que atravessa a meia-noite UTC ainda pode ser o mesmo dia aqui.
    chegar(
      mensagem('2026-08-28T12:00:00.000Z', { content: 'ontem' }, 1),
      mensagem('2026-08-29T12:00:00.000Z', { content: 'hoje' }, 2),
    )
    render(<MessageList escrevendo={false} />)

    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('autor removido aparece como usuario removido, nunca como vazio', () => {
    chegar(mensagem('2026-08-29T12:00:00.000Z', { authorId: null, content: 'orfa' }, 1))
    render(<MessageList escrevendo={false} />)

    expect(screen.getByText('usuario removido')).toBeInTheDocument()
  })

  it('estado vazio traz instrucao concreta, nao ilustracao', () => {
    render(<MessageList escrevendo={false} />)
    expect(screen.getByText(/Escreva a primeira/)).toBeInTheDocument()
  })

  it('mostra o marcador de novas mensagens so para quem rolou para cima', () => {
    chegar(mensagem('2026-08-29T12:00:00.000Z', { content: 'antiga' }, 1))
    render(<MessageList escrevendo={false} />)

    rolarPara(screen.getByRole('log'), 100)
    chegar(mensagem('2026-08-29T12:05:00.000Z', { content: 'nova' }, 2))

    // Puxar a rolagem de quem esta revisando o historico seria arrancar a
    // leitura da mao dela.
    expect(screen.getByRole('button', { name: /novas mensagens/i })).toBeInTheDocument()
  })

  it('sem rolagem para cima, nao ha marcador atrapalhando', () => {
    chegar(mensagem('2026-08-29T12:00:00.000Z', { content: 'antiga' }, 1))
    render(<MessageList escrevendo={false} />)

    chegar(mensagem('2026-08-29T12:05:00.000Z', { content: 'nova' }, 2))
    expect(screen.queryByRole('button', { name: /novas mensagens/i })).not.toBeInTheDocument()
  })

  it('carrega o historico anterior ao rolar para o topo', async () => {
    const carregarAnteriores = vi.fn()
    chegar(mensagem('2026-08-29T12:00:00.000Z', { content: 'a mais antiga que tenho' }, 1))
    render(<MessageList escrevendo={false} carregarAnteriores={carregarAnteriores} />)

    rolarPara(screen.getByRole('log'), 0)

    await vi.waitFor(() => expect(carregarAnteriores).toHaveBeenCalledWith(
      expect.stringContaining('-'),
    ))
  })

  it('eco ainda nao confirmado aparece ocupado', () => {
    act(() => useStore.getState().registrarEco(
      mensagem('2026-08-29T12:00:00.000Z', { authorId: 'u1', content: 'indo', envio: 'enviando' }),
    ))
    render(<MessageList escrevendo={false} />)

    expect(screen.getByText('indo').closest('article')).toHaveAttribute('aria-busy', 'true')
  })
})
