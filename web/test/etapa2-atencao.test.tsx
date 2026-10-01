import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore, naoLidasDoCanal } from '../src/lib/store.js'
import { decidir, nivelDoCanal, prazoDoSilencio, canalSilenciado } from '../src/lib/atencao.js'
import { caminhoDe, lerRota } from '../src/lib/rota.js'
import { resumoDeAtencao, useIndicadorDeAtencao } from '../src/lib/notificacoes.js'
import { Presenca } from '../src/features/presence/Presenca.js'
import { MenuDeNotificacao } from '../src/features/presence/MenuDeNotificacao.js'
import { ListaCanais } from '../src/features/channels/ListaCanais.js'
import { prazoDoStatus } from '../src/features/settings/status.js'
import type { Mensagem, Membro, Ready } from '../src/lib/tipos.js'

const G = '0198f0aa-0000-7000-8000-00000000000a'
const C1 = '0198f0aa-0000-7000-8000-0000000000c1'
const C2 = '0198f0aa-0000-7000-8000-0000000000c2'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null, status: 'online' },
  groups: [{ id: G, name: 'Anticorp', iconUrl: null, role: 'member' }],
  channels: [
    { id: C1, groupId: G, name: 'geral', type: 'text', visibility: 'public', topic: null, position: 0 },
    { id: C2, groupId: G, name: 'avisos', type: 'text', visibility: 'public', topic: null, position: 1 },
  ],
  members: [
    { groupId: G, userId: 'u1', displayName: 'Felipe', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: G, userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
  ],
  unread: { [C2]: { n: 5, mentions: 1 } },
  notificationPrefs: [],
  serverTime: '2026-09-26T12:00:00.000Z',
}

function msg(id: string, extras: Partial<Mensagem> = {}): Mensagem {
  return {
    id, channelId: C2, authorId: 'u2', content: 'oi', createdAt: '2026-09-26T12:00:00Z',
    editedAt: null, ...extras,
  }
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  act(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    useStore.getState().escolherCanal(C1)
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('2.2 · nao lidas contadas pelo servidor', () => {
  it('o ready traz a contagem de um canal nunca aberto', () => {
    expect(naoLidasDoCanal(useStore.getState(), C2)).toBe(5)
  })

  it('mensagem nova alheia soma; a minha e a repetida nao', () => {
    act(() => {
      const { aplicarEvento } = useStore.getState()
      aplicarEvento({ t: 'message.created', d: msg('0198f0aa-0001-7000-8000-000000000001') })
      aplicarEvento({ t: 'message.created', d: msg('0198f0aa-0001-7000-8000-000000000001') })
      aplicarEvento({ t: 'message.created', d: msg('0198f0aa-0001-7000-8000-000000000002', { authorId: 'u1' }) })
      aplicarEvento({
        t: 'message.created',
        d: msg('0198f0aa-0001-7000-8000-000000000003', { mentions: ['u1'] }),
      })
    })
    expect(useStore.getState().naoLidas[C2]).toEqual({ n: 7, mentions: 2 })
  })

  it('ler zera, e a leitura de outra aba tambem', () => {
    act(() => { useStore.getState().marcarLido(C2, '0198f0aa-0001-7000-8000-000000000009') })
    expect(useStore.getState().naoLidas[C2]).toBeUndefined()

    act(() => {
      useStore.getState().aplicarEvento({
        t: 'unread.update', d: { channelId: C2, lastReadMessageId: 'x', n: 2, mentions: 0 },
      })
    })
    expect(useStore.getState().naoLidas[C2]).toEqual({ n: 2, mentions: 0 })
    expect(useStore.getState().leituras[C2]).toBe('x')
  })

  it('a lista mostra ponto para nao lida e numero para mencao', () => {
    render(<ListaCanais />)
    const avisos = screen.getByRole('button', { name: /avisos/ })
    expect(avisos).toHaveTextContent('1')
    expect(avisos).toHaveAccessibleName(/1 menção a você/)
  })
})

describe('2.4 · a regra unica de interromper', () => {
  const ctx = () => useStore.getState()
  const canal = { id: C2, groupId: G }

  it('mencao notifica; mensagem comum depende do nivel', () => {
    expect(decidir(ctx(), canal, msg('m', { mentions: ['u1'] }))).toBe('notificar')
    expect(decidir(ctx(), canal, msg('m'))).toBe('notificar')

    act(() => {
      useStore.getState().aplicarEvento({
        t: 'notification-prefs.updated', d: { scopeType: 'group', scopeId: G, level: 'mentions', mutedUntil: null },
      })
    })
    expect(nivelDoCanal(ctx(), canal)).toBe('mentions')
    expect(decidir(ctx(), canal, msg('m'))).toBe('calar')
    expect(decidir(ctx(), canal, msg('m', { mentionsEveryone: true }))).toBe('notificar')
  })

  it('o nivel do canal vence o do grupo', () => {
    act(() => {
      const { aplicarEvento } = useStore.getState()
      aplicarEvento({ t: 'notification-prefs.updated', d: { scopeType: 'group', scopeId: G, level: 'none', mutedUntil: null } })
      aplicarEvento({ t: 'notification-prefs.updated', d: { scopeType: 'channel', scopeId: C2, level: 'all', mutedUntil: null } })
    })
    expect(decidir(ctx(), canal, msg('m'))).toBe('notificar')
  })

  it('canal silenciado nunca notifica, nem mencao', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'notification-prefs.updated',
        d: { scopeType: 'channel', scopeId: C2, level: null, mutedUntil: prazoDoSilencio(60) },
      })
    })
    expect(canalSilenciado(ctx(), canal)).toBe(true)
    expect(decidir(ctx(), canal, msg('m', { mentions: ['u1'] }))).toBe('calar')
  })

  it('nivel none cala ate a mencao', () => {
    act(() => {
      useStore.getState().aplicarEvento({ t: 'notification-prefs.updated', d: { scopeType: 'channel', scopeId: C2, level: 'none', mutedUntil: null } })
    })
    expect(decidir(ctx(), canal, msg('m', { mentions: ['u1'] }))).toBe('calar')
  })

  it('grupo com mais de 50 pessoas comeca em "so mencoes"', () => {
    const muitos: Membro[] = Array.from({ length: 51 }, (_, i) => ({
      groupId: G, userId: `x${String(i)}`, displayName: `X${String(i)}`, avatarUrl: null, role: 'member', status: 'offline',
    }))
    act(() => { useStore.setState({ members: muitos }) })
    expect(nivelDoCanal(ctx(), canal)).toBe('mentions')
  })

  it('nao perturbe cala tudo', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'user.status', d: { status: 'dnd', statusText: null, statusEmoji: null, statusExpiresAt: null },
      })
    })
    expect(decidir(ctx(), canal, msg('m', { mentions: ['u1'] }))).toBe('calar')
  })

  it('o menu grava o silencio e aplica a resposta na hora', async () => {
    const pessoa = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, opcoes?: RequestInit) => {
      const corpo = JSON.parse(String(opcoes?.body)) as Record<string, unknown>
      return json(200, corpo)
    }))
    render(<MenuDeNotificacao scopeType="channel" scopeId={C2} groupId={G} />)
    await pessoa.click(screen.getByRole('button', { name: 'Notificações do canal' }))
    await pessoa.click(await screen.findByRole('menuitemradio', { name: /Só menções/ }))
    await waitFor(() => expect(nivelDoCanal(useStore.getState(), { id: C2, groupId: G })).toBe('mentions'))
  })
})

describe('2.1 · links diretos', () => {
  it('a rota de mensagem vai e volta', () => {
    const rota = { nome: 'canal' as const, grupo: G, canal: C1, mensagem: C2 }
    expect(lerRota({ pathname: caminhoDe(rota), search: '' })).toEqual(rota)
    expect(caminhoDe({ nome: 'canal', grupo: G, canal: C1 })).toBe(`/g/${G}/c/${C1}`)
  })
})

describe('2.6 · titulo e favicon', () => {
  function Indicador(): null {
    useIndicadorDeAtencao(true)
    return null
  }

  it('mencao mostra o numero no titulo; nao lida sem mencao, so o ponto', () => {
    render(<Indicador />)
    expect(document.title).toBe('(1) Altcast')
    act(() => {
      useStore.setState({ naoLidas: { [C2]: { n: 3, mentions: 0 } } })
    })
    expect(document.title).toBe('• Altcast')
    expect(resumoDeAtencao()).toEqual({ mencoes: 0, canaisNaoLidos: 1 })
  })
})

describe('2.9 · presenca com forma', () => {
  it('cada estado tem uma forma propria', () => {
    const { container, rerender } = render(<Presenca status="online" />)
    expect(container.querySelector('[data-presenca]')).toHaveAttribute('data-presenca', 'cheio')
    rerender(<Presenca status="idle" />)
    expect(container.querySelector('[data-presenca]')).toHaveAttribute('data-presenca', 'lua')
    expect(screen.getByText('ausente')).toBeInTheDocument()
    rerender(<Presenca status="dnd" />)
    expect(container.querySelector('[data-presenca]')).toHaveAttribute('data-presenca', 'traco')
    rerender(<Presenca status="offline" />)
    expect(container.querySelector('[data-presenca]')).toHaveAttribute('data-presenca', 'vazado')
  })

  it('presence.update com frase aparece na lista; offline apaga a frase', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'presence.update', d: { userId: 'u2', status: 'dnd', statusText: 'Em reunião', statusEmoji: '📅' },
      })
    })
    expect(useStore.getState().members.find(m => m.userId === 'u2')).toMatchObject({
      status: 'dnd', statusText: 'Em reunião',
    })
    act(() => {
      useStore.getState().aplicarEvento({ t: 'presence.update', d: { userId: 'u2', status: 'offline' } })
    })
    expect(useStore.getState().members.find(m => m.userId === 'u2')?.statusText).toBeNull()
  })

  it('"hoje" termina a meia-noite local', () => {
    const agora = new Date(2026, 8, 26, 14, 0, 0)
    const fim = new Date(prazoDoStatus(-1, agora)!)
    expect(fim.getDate()).toBe(26)
    expect(fim.getHours()).toBe(23)
    expect(prazoDoStatus(null)).toBeNull()
  })
})
