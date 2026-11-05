import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { montarPedidoDeAtividade } from '../src/features/assistir/atividadeNoDiscord.js'
import type { FatosDaChamada } from '../src/features/assistir/atividadeNoDiscord.js'
import { aplicarEventoDePedido, usePedidosParaAssistir } from '../src/features/assistir/pedidos.js'
import { PedirParaAssistir } from '../src/features/assistir/PedirParaAssistir.js'
import { PedidosRecebidos } from '../src/features/assistir/PedidosRecebidos.js'
import { caminhoDe, lerRota } from '../src/lib/rota.js'
import type { Canal, Grupo } from '../src/lib/tipos.js'

const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const C = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

const canal: Canal = {
  id: C, groupId: 'g1', name: 'sala', type: 'voice', visibility: 'public', topic: null, position: 0,
}
const grupo: Grupo = { id: 'g1', name: 'Time', iconUrl: null, role: 'owner' }

function fatos(extra: Partial<FatosDaChamada> = {}): FatosDaChamada {
  return {
    clientId: '123456789012345678', ligado: true, emChamada: true, tela: true,
    canal, grupo, podeConvidar: true, emailVerificado: true, userId: U,
    origem: 'https://altcast.exemplo', inicioDaChamada: 1_000, inicioDaTela: 2_000,
    ...extra,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, {}))))
  act(() => { usePedidosParaAssistir.getState().limpar() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('o que vai para o cartao do Discord', () => {
  it('transmitindo num canal publico: estado, grupo, tempo da tela e link', () => {
    expect(montarPedidoDeAtividade(fatos())).toEqual({
      clientId: '123456789012345678',
      estado: 'transmitindo',
      grupo: 'Time',
      desde: 2_000,
      linkParaAssistir: `https://altcast.exemplo/assistir/${U}/${C}`,
    })
  })

  it('em chamada sem tela: conta desde a entrada, sem link', () => {
    expect(montarPedidoDeAtividade(fatos({ tela: false, inicioDaTela: null }))).toMatchObject({
      estado: 'chamada', desde: 1_000, linkParaAssistir: null,
    })
  })

  it.each([
    ['sem Client ID no servidor', { clientId: null }],
    ['desligado em Configuracoes', { ligado: false }],
    ['fora de chamada', { emChamada: false }],
  ])('nada vai ao Discord (%s)', (_caso, extra) => {
    expect(montarPedidoDeAtividade(fatos(extra))).toBeNull()
  })

  /** O botao so aparece quando o pedido teria como dar certo do outro lado. */
  it.each([
    ['canal privado', { canal: { ...canal, visibility: 'private' as const } }],
    ['sem permissao de convidar', { podeConvidar: false }],
    ['e-mail nao confirmado', { emailVerificado: false }],
  ])('transmitindo, mas sem botao (%s)', (_caso, extra) => {
    const p = montarPedidoDeAtividade(fatos(extra))
    expect(p?.estado).toBe('transmitindo')
    expect(p?.linkParaAssistir).toBeNull()
  })

  it('conversa direta nao diz com quem, e nao tem botao', () => {
    const p = montarPedidoDeAtividade(fatos({ grupo: { ...grupo, name: 'Ana', kind: 'dm' } }))
    expect(p?.grupo).toBeNull()
    expect(p?.linkParaAssistir).toBeNull()
  })
})

describe('a rota do botao', () => {
  it('le e escreve /assistir/<quem>/<canal>', () => {
    const rota = lerRota({ pathname: `/assistir/${U}/${C}`, search: '' })
    expect(rota).toEqual({ nome: 'assistir', anfitriao: U, canal: C })
    expect(caminhoDe(rota)).toBe(`/assistir/${U}/${C}`)
  })
})

describe('os eventos dos pedidos', () => {
  const pedido = {
    id: 'p1', groupId: 'g1', groupName: 'Time', channelId: C, channelName: 'sala',
    solicitante: { id: 'u9', displayName: 'Bia', avatarUrl: null }, criadoEm: '2026-11-04T00:00:00Z',
  }

  it('chegou, repetido na reconexao, conta uma vez; fechado em outra aba some', () => {
    act(() => {
      aplicarEventoDePedido({ t: 'watch_request.received', d: pedido })
      aplicarEventoDePedido({ t: 'watch_request.received', d: pedido })
    })
    expect(usePedidosParaAssistir.getState().recebidos).toHaveLength(1)
    act(() => { aplicarEventoDePedido({ t: 'watch_request.closed', d: { id: 'p1' } }) })
    expect(usePedidosParaAssistir.getState().recebidos).toHaveLength(0)
  })

  it('outros eventos nao sao deste assunto', () => {
    expect(aplicarEventoDePedido({ t: 'message.created', d: {} })).toBe(false)
  })

  it('quem transmite ve o cartao e aceita', async () => {
    vi.mocked(fetch).mockImplementation((entrada: RequestInfo | URL) =>
      Promise.resolve(String(entrada).endsWith('/pedidos-para-assistir')
        ? json(200, [pedido])
        : new Response(null, { status: 204 })))
    const pessoa = userEvent.setup()
    render(<PedidosRecebidos />)

    expect(await screen.findByText('Bia')).toBeInTheDocument()
    expect(screen.getByText('Time · sala')).toBeInTheDocument()
    await pessoa.click(screen.getByRole('button', { name: 'Aceitar' }))

    const chamadas = vi.mocked(fetch).mock.calls.map(([url, o]) => [String(url), o?.method])
    expect(chamadas).toContainEqual(['/api/pedidos-para-assistir/p1/aceitar', 'POST'])
    await waitFor(() => { expect(screen.queryByText('Bia')).not.toBeInTheDocument() })
  })
})

describe('quem clicou em "Assistir no Altcast"', () => {
  const previa = {
    anfitriao: { displayName: 'Felipe', avatarUrl: null },
    grupo: { name: 'Time', iconUrl: null }, tela: true, membro: false,
  }

  it('pede, espera, e entra no canal quando aceitam', async () => {
    vi.mocked(fetch).mockImplementation((_e: RequestInfo | URL, o?: RequestInit) =>
      Promise.resolve(o?.method === 'POST' ? json(202, { id: 'p1' }) : json(200, previa)))
    const pessoa = userEvent.setup()
    render(<PedirParaAssistir anfitriao={U} canal={C} />)

    expect(await screen.findByText('Felipe está transmitindo a tela')).toBeInTheDocument()
    await pessoa.click(screen.getByRole('button', { name: 'Pedir para assistir' }))
    expect(await screen.findByRole('button', { name: 'Aguardando…' })).toBeDisabled()

    act(() => {
      aplicarEventoDePedido({ t: 'watch_request.accepted', d: { id: 'p1', groupId: 'g1', channelId: C } })
    })
    await waitFor(() => { expect(window.location.pathname).toBe(`/g/g1/c/${C}`) })
  })

  it('recusado: diz que nao foi desta vez', async () => {
    vi.mocked(fetch).mockImplementation((_e: RequestInfo | URL, o?: RequestInit) =>
      Promise.resolve(o?.method === 'POST' ? json(202, { id: 'p2' }) : json(200, previa)))
    const pessoa = userEvent.setup()
    render(<PedirParaAssistir anfitriao={U} canal={C} />)

    await pessoa.click(await screen.findByRole('button', { name: 'Pedir para assistir' }))
    await screen.findByRole('button', { name: 'Aguardando…' })
    act(() => { aplicarEventoDePedido({ t: 'watch_request.declined', d: { id: 'p2' } }) })
    expect(await screen.findByText('Felipe não aceitou o pedido desta vez.')).toBeInTheDocument()
  })

  it('transmissao que acabou: diz isso, sem botao de pedir', async () => {
    vi.mocked(fetch).mockResolvedValue(json(404, {
      error: { code: 'stream_unavailable', message: 'Esta transmissão terminou ou não aceita pedidos.' },
    }))
    render(<PedirParaAssistir anfitriao={U} canal={C} />)
    expect(await screen.findByText('Esta transmissão terminou ou não aceita pedidos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir para assistir' })).not.toBeInTheDocument()
  })
})
