import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PersonalizarPerfil } from '../src/features/settings/PersonalizarPerfil.js'
import { CartaoDePerfil } from '../src/features/presence/CartaoDePerfil.js'
import { usePerfilAberto } from '../src/features/presence/perfilAberto.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'
import { violacoes } from './helpers/axe.js'

/**
 * O perfil personalizavel: banner, pronomes e "sobre mim".
 *
 * Os dois lados: quem edita ve a previa mudar a cada tecla e salva num PATCH
 * so; quem abre o cartao de alguem ve o perfil que chegou do servidor.
 */

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

describe('personalizar o proprio perfil', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    act(() => {
      useStore.setState({
        user: { id: 'u1', displayName: 'Felipe', avatarUrl: null, username: 'felipe', bio: null },
      })
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('a prévia mostra a bio enquanto a pessoa escreve', async () => {
    render(<PersonalizarPerfil aoConfirmar={() => undefined} />)

    await userEvent.type(screen.getByLabelText('Sobre mim'), 'Toco baixo')

    expect(screen.getByText('Toco baixo', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('10/190')).toBeInTheDocument()
  })

  it('salvar manda bio, pronomes e cor num PATCH só, e a store fica igual ao servidor', async () => {
    const corpos: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      corpos.push(JSON.parse(String(init?.body)))
      return json({
        user: {
          id: 'u1', displayName: 'Felipe', avatarUrl: null,
          bio: 'Oi', pronouns: 'ele/dele', bannerColor: '#5865f2', bannerUrl: null,
        },
      })
    })
    const aoConfirmar = vi.fn()
    render(<PersonalizarPerfil aoConfirmar={aoConfirmar} />)

    await userEvent.type(screen.getByLabelText('Sobre mim'), 'Oi')
    await userEvent.type(screen.getByLabelText('Pronomes'), 'ele/dele')
    await userEvent.click(screen.getByRole('button', { name: 'Cor #5865f2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))

    await waitFor(() => { expect(aoConfirmar).toHaveBeenCalledWith('Perfil atualizado.') })
    expect(corpos[0]).toEqual({ bio: 'Oi', pronouns: 'ele/dele', bannerColor: '#5865f2' })
    expect(useStore.getState().user?.pronouns).toBe('ele/dele')
  })

  it('sem mudança nada a salvar', () => {
    render(<PersonalizarPerfil aoConfirmar={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Salvar perfil' })).toBeDisabled()
  })

  it('axe não encontra violação', async () => {
    const { container } = render(<PersonalizarPerfil aoConfirmar={() => undefined} />)
    expect(await violacoes(container)).toEqual([])
  })
})

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: 'g1', name: 'Time', iconUrl: null, role: 'owner' }],
  channels: [],
  members: [
    { groupId: 'g1', userId: 'u1', displayName: 'Felipe', avatarUrl: null, role: 'owner', status: 'online' },
    { groupId: 'g1', userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
  ],
  serverTime: '2026-09-29T12:00:00.000Z',
}

describe('o cartão de perfil de outra pessoa', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    act(() => { useStore.getState().aplicarReady(READY) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    act(() => { usePerfilAberto.getState().fecharPerfil() })
  })

  it('abre na hora com o nome e completa com bio e pronomes do servidor', async () => {
    const pedidos: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      pedidos.push(String(url))
      return json({
        profile: {
          userId: 'u2', displayName: 'Ana', username: 'ana', avatarUrl: null,
          bio: 'Designer e baterista', pronouns: 'ela/dela',
          bannerColor: '#e91e63', bannerUrl: null, createdAt: '2026-01-10T00:00:00.000Z',
        },
      })
    })

    render(<CartaoDePerfil />)
    act(() => { usePerfilAberto.getState().abrirPerfil('u2') })

    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(await screen.findByText('Designer e baterista')).toBeInTheDocument()
    expect(screen.getByText('ela/dela')).toBeInTheDocument()
    expect(screen.getByText('@ana')).toBeInTheDocument()
    expect(pedidos[0]).toBe('/api/users/u2/profile')
  })

  it('se o perfil não vier, o cartão continua útil com o que já tinha', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: { code: 'not_found', message: 'x' } }, 404))

    render(<CartaoDePerfil />)
    act(() => { usePerfilAberto.getState().abrirPerfil('u2') })

    expect(screen.getByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    await waitFor(() => { expect(screen.queryByText('Sobre mim')).not.toBeInTheDocument() })
  })
})
