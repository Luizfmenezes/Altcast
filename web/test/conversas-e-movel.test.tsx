import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../src/AppShell.js'
import { conversasVisiveis, outroDaConversa, useStore } from '../src/lib/store.js'
import { pessoasAlcancaveis } from '../src/lib/conversas.js'
import { PASTEIS, TINTA, TINTA_SUAVE } from '../src/features/movel/cores.js'
import type { Ready } from '../src/lib/tipos.js'
import { contrast } from './helpers/contrast.js'
import { violacoes } from './helpers/axe.js'

const G = '0198f0aa-0000-7000-8000-00000000000a'
const DM = '0198f0aa-0000-7000-8000-0000000000d1'
const GERAL = '0198f0aa-0000-7000-8000-0000000000c1'
const DM_TEXTO = '0198f0aa-0000-7000-8000-0000000000d2'
const DM_VOZ = '0198f0aa-0000-7000-8000-0000000000d3'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe Menezes', avatarUrl: null, status: 'online' },
  groups: [
    { id: G, name: 'Anticorp', iconUrl: null, role: 'member', kind: 'group' },
    // O nome "Conversa" vem do servidor e nunca pode aparecer como grupo.
    { id: DM, name: 'Conversa', iconUrl: null, role: 'member', kind: 'dm', hidden: false },
  ],
  channels: [
    { id: GERAL, groupId: G, name: 'geral', type: 'text', visibility: 'public', topic: null, position: 0 },
    { id: DM_TEXTO, groupId: DM, name: 'conversa', type: 'text', visibility: 'public', topic: null, position: 0 },
    { id: DM_VOZ, groupId: DM, name: 'chamada', type: 'voice', visibility: 'public', topic: null, position: 1 },
  ],
  members: [
    { groupId: G, userId: 'u1', displayName: 'Felipe Menezes', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: G, userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: G, userId: 'u3', displayName: 'Bruno', avatarUrl: null, role: 'member', status: 'offline' },
    { groupId: DM, userId: 'u1', displayName: 'Felipe Menezes', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: DM, userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
  ],
  unread: { [DM_TEXTO]: { n: 2, mentions: 0 }, [GERAL]: { n: 3, mentions: 1 } },
  notificationPrefs: [],
  serverTime: '2026-09-30T12:00:00.000Z',
}

function larguraDe(px: number): void {
  vi.stubGlobal('matchMedia', (consulta: string) => {
    const minimo = /min-width:\s*(\d+)px/.exec(consulta)
    return {
      matches: minimo ? px >= Number(minimo[1]) : false,
      media: consulta,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined,
      onchange: null, dispatchEvent: () => false,
    }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  ))
  act(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('conversas diretas na store', () => {
  it('o ready nunca abre uma conversa como grupo inicial', () => {
    expect(useStore.getState().grupoAtivo).toBe(G)
    expect(useStore.getState().area).toBe('grupos')
  })

  it('escolher a conversa abre o canal de TEXTO dela e muda de area', () => {
    act(() => { useStore.getState().escolherGrupo(DM) })
    expect(useStore.getState()).toMatchObject({ area: 'conversas', canalAtivo: DM_TEXTO })
    expect(outroDaConversa(useStore.getState(), DM)?.displayName).toBe('Ana')
  })

  it('fechar a conversa aberta tira da lista e sai dela; a mensagem nova reabre', () => {
    act(() => { useStore.getState().escolherGrupo(DM) })
    act(() => { useStore.getState().aplicarEvento({ t: 'dm.hidden', d: { groupId: DM } }) })
    expect(conversasVisiveis(useStore.getState())).toHaveLength(0)
    expect(useStore.getState().grupoAtivo).toBeNull()

    act(() => { useStore.getState().aplicarEvento({ t: 'dm.shown', d: { groupId: DM } }) })
    expect(conversasVisiveis(useStore.getState()).map(g => g.id)).toEqual([DM])
  })

  it('conversa nova chega com os participantes e puxa a tela para ela', () => {
    const NOVA = '0198f0aa-0000-7000-8000-0000000000e1'
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'group.created',
        d: {
          group: { id: NOVA, name: 'Conversa', iconUrl: null, role: 'member', kind: 'dm', hidden: false },
          channels: [{ id: 'e2', groupId: NOVA, name: 'conversa', type: 'text', visibility: 'public', topic: null, position: 0 }],
          members: [
            { groupId: NOVA, userId: 'u1', displayName: 'Felipe Menezes', avatarUrl: null, role: 'member', status: 'online' },
            { groupId: NOVA, userId: 'u3', displayName: 'Bruno', avatarUrl: null, role: 'member', status: 'offline' },
          ],
        },
      })
    })
    expect(useStore.getState()).toMatchObject({ grupoAtivo: NOVA, canalAtivo: 'e2', area: 'conversas' })
    expect(outroDaConversa(useStore.getState(), NOVA)?.displayName).toBe('Bruno')
  })

  it('so oferece conversa com quem divide um GRUPO, uma vez por pessoa, sem mim', () => {
    expect(pessoasAlcancaveis(useStore.getState()).map(p => p.displayName)).toEqual(['Ana', 'Bruno'])
  })
})

describe('conversas no desktop', () => {
  it('a conversa nao entra no trilho de grupos; o botao Conversas mostra as nao lidas', () => {
    larguraDe(1400)
    render(<AppShell />)
    const trilho = screen.getByRole('navigation', { name: 'Grupos' })
    expect(within(trilho).queryByText('Conversa')).toBeNull()
    expect(within(trilho).getByRole('button', { name: /Conversas \(2 não lidas\)/ })).toBeInTheDocument()
  })

  it('abrir Conversas troca a coluna de canais pela lista de conversas', async () => {
    larguraDe(1400)
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.click(screen.getByRole('button', { name: /Conversas \(2 não lidas\)/ }))
    const coluna = screen.getByRole('navigation', { name: 'Conversas diretas' })
    expect(within(coluna).getByRole('button', { name: /Ana, 2 não lidas/ })).toBeInTheDocument()
    // O cabecalho da conversa e a pessoa, com o botao de ligar.
    expect(screen.getByRole('button', { name: 'Ligar para Ana' })).toBeInTheDocument()
  })
})

describe('no celular', () => {
  it('em 390px o app vira telas com abas no pe', () => {
    larguraDe(390)
    render(<AppShell />)
    const abas = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(abas).getByRole('button', { name: /Início/ })).toHaveAttribute('aria-current', 'page')
    expect(within(abas).getByRole('button', { name: /Conversas.*2 não lidas/ })).toBeInTheDocument()
    // O cartao grande conta o que chegou nos grupos — a conversa conta na aba dela.
    expect(screen.getByRole('region', { name: 'Resumo do que chegou' })).toHaveTextContent('3')
    // As colunas do desktop nao existem aqui.
    expect(screen.queryByRole('navigation', { name: 'Grupos' })).toBeNull()
  })

  it('grupo, canal e voltar: uma tela por vez', async () => {
    larguraDe(390)
    const usuario = userEvent.setup()
    render(<AppShell />)

    await usuario.click(screen.getByRole('button', { name: /^Anticorp/ }))
    // Dentro da tela do GRUPO: a casa, ainda saindo de cena, tambem lista
    // #geral em "Atividade", e clicar la seria abrir o canal por outro caminho.
    const textos = await screen.findByRole('region', { name: 'Canais de texto' })
    await usuario.click(within(textos).getByRole('button', { name: /geral/ }))
    expect(screen.getByRole('region', { name: 'Conversa' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).toBeNull()

    await usuario.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByRole('heading', { name: 'Anticorp', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('a aba Conversas abre a conversa em tela cheia', async () => {
    larguraDe(390)
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.click(screen.getByRole('button', { name: /Conversas.*não lidas/ }))
    await usuario.click(await screen.findByRole('button', { name: /Ana, 2 não lidas/ }))
    expect(screen.getByRole('heading', { name: 'Ana', level: 1 })).toBeInTheDocument()
  })

  it('axe nao encontra violacao na casa do celular', async () => {
    larguraDe(390)
    const { container } = render(<AppShell />)
    expect(await violacoes(container)).toEqual([])
  })
})

describe('os pasteis do celular', () => {
  it('a tinta passa de 4,5:1 sobre todo pastel, a principal e a suave', () => {
    for (const p of PASTEIS) {
      expect(contrast(TINTA, p)).toBeGreaterThanOrEqual(12)
      expect(contrast(TINTA_SUAVE, p)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
