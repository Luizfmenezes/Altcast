import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { violacoes } from './helpers/axe.js'
import { AppShell } from '../src/AppShell.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const GRUPO = 'g1'

/**
 * O `ready` que o servidor entregaria a um member comum: ele participa de
 * #geral e #planejamento, e o canal #diretoria simplesmente nao esta aqui,
 * porque ele nao pertence a lista de acesso.
 */
const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'member' }],
  channels: [
    {
      id: 'c1', groupId: GRUPO, name: 'geral', type: 'text',
      visibility: 'public', topic: null, position: 0,
    },
    {
      id: 'c2', groupId: GRUPO, name: 'planejamento', type: 'text',
      visibility: 'public', topic: 'o que vem depois', position: 1,
    },
  ],
  members: [
    {
      groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'member', status: 'online',
    },
    {
      groupId: GRUPO, userId: 'u2', displayName: 'Ana',
      avatarUrl: null, role: 'admin', status: 'offline',
    },
  ],
  serverTime: '2026-08-29T12:00:00.000Z',
}

/** jsdom nao implementa matchMedia; os pontos de quebra dependem dele. */
function larguraDe(px: number): void {
  vi.stubGlobal('matchMedia', (consulta: string) => {
    const minimo = /min-width:\s*(\d+)px/.exec(consulta)
    const combina = minimo ? px >= Number(minimo[1]) : false
    return {
      matches: combina, media: consulta,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined,
      onchange: null, dispatchEvent: () => false,
    }
  })
}

/** Os botoes de canal, na ordem em que aparecem na barra lateral. */
function dentroDaListaDeCanais(): HTMLElement[] {
  const nav = screen.getAllByRole('navigation', { name: 'Canais do grupo' })[0]!
  return [...nav.querySelectorAll('li > button')] as HTMLElement[]
}

function canal(nome: string): HTMLElement {
  const alvo = dentroDaListaDeCanais().find(b => b.textContent === nome)
  if (!alvo) throw new Error(`canal ${nome} nao esta na lista`)
  return alvo
}

describe('estrutura da aplicacao', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    useStore.getState().definirConexao('conectado')
    larguraDe(1400)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('canal privado sem acesso nao aparece, nem com cadeado', () => {
    const { container } = render(<AppShell />)

    // Contrapartida no frontend da Tarefa 14: o servidor nao envia o canal, e a
    // interface nao inventa cadeado nem espaco reservado.
    expect(container.textContent).not.toContain('diretoria')
    expect(screen.queryByText(/privado/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/bloqueado|sem acesso/i)).not.toBeInTheDocument()
  })

  it('lista os canais visiveis na ordem de posicao', () => {
    render(<AppShell />)
    // A lista de canais e navegacao, e nao um `tablist`: `tab` prometeria um
    // `tabpanel` que a conversa nunca foi, e o cabecalho colapsavel de cada
    // secao nao pode viver dentro de um tablist sem reprovar em
    // aria-required-children. O canal aberto se anuncia com aria-current.
    const nomes = dentroDaListaDeCanais().map(b => b.textContent)
    expect(nomes).toEqual(['geral', 'planejamento'])
  })

  it('o canal aberto e o unico marcado como atual', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)
    await usuario.click(canal('planejamento'))
    const atuais = dentroDaListaDeCanais().filter(b => b.getAttribute('aria-current') === 'true')
    expect(atuais.map(b => b.textContent)).toEqual(['planejamento'])
  })

  it('trocar de canal move o foco para o campo de escrita', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)

    await usuario.click(canal('planejamento'))
    // Sem isto, quem navega por teclado se perde a cada troca de canal.
    expect(screen.getByLabelText('Escrever mensagem')).toHaveFocus()
  })

  it('trocar de canal anuncia o nome numa regiao de status', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)

    await usuario.click(canal('planejamento'))
    expect(screen.getByRole('status', { name: 'Canal atual' }))
      .toHaveTextContent('planejamento')
  })

  it('Alt com seta navega entre canais sem mouse', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)

    await usuario.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(useStore.getState().canalAtivo).toBe('c2')

    await usuario.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(useStore.getState().canalAtivo).toBe('c1')

    // Na ponta a navegacao para, em vez de dar a volta: dar a volta faria a
    // pessoa passar do fim ao inicio sem perceber que mudou de lugar.
    await usuario.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(useStore.getState().canalAtivo).toBe('c1')
  })

  it('link de pular para a conversa e o primeiro elemento focavel', async () => {
    const usuario = userEvent.setup()
    render(<AppShell />)

    await usuario.tab()
    expect(document.activeElement).toHaveTextContent('Pular para a conversa')
  })

  it('em 640px a lista de canais vira gaveta sob demanda', async () => {
    larguraDe(640)
    const usuario = userEvent.setup()
    render(<AppShell />)

    // Fora da gaveta, os canais nao ocupam espaco permanente na tela estreita.
    expect(screen.queryByRole('button', { name: 'geral' })).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Abrir canais' }))
    expect(canal('geral')).toBeInTheDocument()

    await usuario.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'geral' })).not.toBeInTheDocument()
  })

  it('em 1000px o painel de membros colapsa e volta por botao', async () => {
    larguraDe(1000)
    const usuario = userEvent.setup()
    render(<AppShell />)

    expect(screen.queryByRole('complementary', { name: 'Membros' })).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Mostrar membros' }))
    expect(screen.getByRole('complementary', { name: 'Membros' })).toBeInTheDocument()
  })

  it('presenca nunca e so cor: tem forma e rotulo textual', () => {
    larguraDe(1400)
    render(<AppShell />)

    const membros = screen.getByRole('complementary', { name: 'Membros' })
    // Daltonico nao pode depender de verde contra cinza (SC 1.4.1).
    expect(within(membros).getByText('Felipe').closest('li'))
      .toHaveTextContent('online')
    expect(within(membros).getByText('Ana').closest('li'))
      .toHaveTextContent('offline')
  })

  it('a barra de conexao diz a verdade sobre o tempo real', () => {
    render(<AppShell />)
    const barra = screen.getByRole('status', { name: 'Estado da conexao' })
    expect(barra).toHaveTextContent('conectado')

    act(() => useStore.getState().definirConexao('reconectando'))
    expect(screen.getByRole('status', { name: 'Estado da conexao' }))
      .toHaveTextContent('reconectando')
  })

  it('axe nao encontra violacao na aplicacao montada', async () => {
    const { container } = render(<AppShell />)
    expect(await violacoes(container)).toEqual([])
  })
})
