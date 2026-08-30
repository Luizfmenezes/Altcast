import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { violacoes } from './helpers/axe.js'
import { ConfiguracoesGrupo } from '../src/features/settings/ConfiguracoesGrupo.js'
import { ConfiguracoesUsuario } from '../src/features/settings/ConfiguracoesUsuario.js'
import { ThemeProvider } from '../src/ui/ThemeProvider.js'
import { useStore } from '../src/lib/store.js'
import type { Ready } from '../src/lib/tipos.js'

const GRUPO = 'g1'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: 'c1', groupId: GRUPO, name: 'geral', type: 'text',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [{
    groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
    avatarUrl: null, role: 'owner', status: 'online',
  }],
  serverTime: '2026-08-29T12:00:00.000Z',
}

const CANAIS_DE_GESTAO = [
  {
    id: 'c1', name: 'geral', type: 'text', visibility: 'public',
    position: 0, createdAt: '2026-08-29T10:00:00.000Z', contentAccessible: true,
  },
  {
    id: 'c9', name: 'diretoria', type: 'text', visibility: 'private',
    position: 1, createdAt: '2026-08-29T11:00:00.000Z', contentAccessible: false,
  },
]

const SESSOES = [
  {
    handle: 'aaaa1111', userAgent: 'Firefox 142 / Windows', ip: '10.0.0.1',
    createdAt: '2026-08-29T09:00:00.000Z', lastSeenAt: '2026-08-29T12:00:00.000Z',
    current: true,
  },
  {
    handle: 'bbbb2222', userAgent: 'Safari / iPhone', ip: '10.0.0.2',
    createdAt: '2026-08-20T09:00:00.000Z', lastSeenAt: '2026-08-21T12:00:00.000Z',
    current: false,
  },
]

/** Responde por rota, para que cada tela receba o que de fato pediria. */
function servidorFalso(sobrescritas: Record<string, unknown> = {}) {
  const respostas: Record<string, unknown> = {
    [`/api/groups/${GRUPO}/channels/manage`]: CANAIS_DE_GESTAO,
    [`/api/groups/${GRUPO}/invites`]: [],
    [`/api/groups/${GRUPO}/members`]: [],
    '/api/auth/sessions': SESSOES,
    ...sobrescritas,
  }
  // O segundo parametro entra porque os testes de canal precisam conferir o
  // METODO e o corpo — nao basta saber que a rota foi chamada.
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init
    const caminho = String(url).split('?')[0]!
    const corpo = respostas[caminho] ?? {}
    return new Response(JSON.stringify(corpo), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })
}

describe('configuracoes', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-density')
    vi.stubGlobal('fetch', servidorFalso())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('admin ve o nome do canal privado, mas nao consegue abri-lo', async () => {
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    // A unica excecao a invisibilidade, e ela vem com o rotulo que a explica.
    expect(await screen.findByText('diretoria')).toBeInTheDocument()
    expect(screen.getByText('Conteudo inacessivel')).toBeInTheDocument()

    const linhaPublica = screen.getByText('geral').closest('li')!
    expect(within(linhaPublica).queryByText('Conteudo inacessivel')).not.toBeInTheDocument()
  })

  it('cria canal de voz mandando o tipo que a pessoa escolheu', async () => {
    const fetchFalso = servidorFalso()
    vi.stubGlobal('fetch', fetchFalso)
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    const formulario = await screen.findByRole('form', { name: 'Novo canal' })
    await userEvent.type(within(formulario).getByLabelText('Nome do canal'), 'reuniao')
    await userEvent.selectOptions(within(formulario).getByLabelText('Tipo'), 'voice')
    await userEvent.click(within(formulario).getByRole('button', { name: 'Criar canal' }))

    const chamada = fetchFalso.mock.calls.find(
      ([url, init]) => String(url).endsWith('/channels') && (init as RequestInit)?.method === 'POST',
    )
    expect(chamada).toBeDefined()
    // Sem o `type`, o servidor criaria um canal de texto em silencio e a
    // pessoa so descobriria ao abrir e nao achar a chamada.
    expect(JSON.parse(String((chamada![1] as RequestInit).body))).toMatchObject({
      name: 'reuniao', type: 'voice', visibility: 'public',
    })
  })

  it('editar um canal manda PATCH com o nome novo', async () => {
    const fetchFalso = servidorFalso()
    vi.stubGlobal('fetch', fetchFalso)
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Editar geral' }))
    const edicao = screen.getByRole('form', { name: 'Editar geral' })
    const nome = within(edicao).getByLabelText('Nome')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'avisos')
    await userEvent.click(within(edicao).getByRole('button', { name: 'Salvar' }))

    const chamada = fetchFalso.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    )
    expect(chamada).toBeDefined()
    expect(JSON.parse(String((chamada![1] as RequestInit).body))).toMatchObject({
      name: 'avisos',
    })
  })

  it('apagar um canal pede confirmacao antes de mandar o DELETE', async () => {
    const fetchFalso = servidorFalso()
    vi.stubGlobal('fetch', fetchFalso)
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Apagar geral' }))
    // Antes de confirmar, nada saiu: apagar canal leva as mensagens junto.
    expect(fetchFalso.mock.calls.some(
      ([, init]) => (init as RequestInit)?.method === 'DELETE',
    )).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Apagar canal' }))
    expect(fetchFalso.mock.calls.some(
      ([url, init]) => (init as RequestInit)?.method === 'DELETE'
        && String(url).endsWith('/channels/c1'),
    )).toBe(true)
  })

  it('gerar convite mostra o codigo em fonte monoespacada', async () => {
    vi.stubGlobal('fetch', servidorFalso({
      [`/api/groups/${GRUPO}/invites`]: { code: 'K7M2P9XQ', uses: 0, maxUses: null },
    }))
    const usuario = userEvent.setup()
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    await usuario.click(await screen.findByRole('button', { name: 'Gerar link' }))

    const codigo = await screen.findByText('K7M2P9XQ')
    // Monoespacada porque este codigo vai ser ditado por telefone.
    expect(codigo.tagName).toBe('CODE')
  })

  it('revogar convite pede confirmacao explicita', async () => {
    vi.stubGlobal('fetch', servidorFalso({
      [`/api/groups/${GRUPO}/invites`]: [
        { code: 'K7M2P9XQ', uses: 1, maxUses: null, expiresAt: null },
      ],
    }))
    const usuario = userEvent.setup()
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    await usuario.click(await screen.findByRole('button', { name: 'Revogar o convite K7M2P9XQ' }))

    // Acao destrutiva nunca acontece no primeiro clique.
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent(/revogar/i)
    expect(within(dialogo).getByRole('button', { name: 'Revogar convite' }))
      .toBeInTheDocument()
  })

  it('a confirmacao devolve o foco ao gatilho quando cancelada com Escape', async () => {
    vi.stubGlobal('fetch', servidorFalso({
      [`/api/groups/${GRUPO}/invites`]: [
        { code: 'K7M2P9XQ', uses: 1, maxUses: null, expiresAt: null },
      ],
    }))
    const usuario = userEvent.setup()
    render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)

    const gatilho = await screen.findByRole('button', { name: 'Revogar o convite K7M2P9XQ' })
    await usuario.click(gatilho)
    await screen.findByRole('alertdialog')

    await usuario.keyboard('{Escape}')
    // Perder o foco ao fechar deixaria quem navega por teclado no inicio da
    // pagina, sem referencia do que acabou de fazer (SC 2.1.2).
    await vi.waitFor(() => expect(gatilho).toHaveFocus())
  })

  it('sessoes ativas listam dispositivo e permitem revogar', async () => {
    const usuario = userEvent.setup()
    render(<ThemeProvider><ConfiguracoesUsuario aoFechar={vi.fn()} /></ThemeProvider>)

    expect(await screen.findByText('Firefox 142 / Windows')).toBeInTheDocument()
    expect(screen.getByText('Safari / iPhone')).toBeInTheDocument()
    // A sessao atual e identificada para que ninguem se desconecte sem querer.
    expect(screen.getByText('Esta sessao')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Encerrar Safari / iPhone' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('trocar densidade e tema persiste entre recarregamentos', async () => {
    const usuario = userEvent.setup()
    const tela = render(
      <ThemeProvider><ConfiguracoesUsuario aoFechar={vi.fn()} /></ThemeProvider>,
    )

    await usuario.click(screen.getByRole('button', { name: 'Tema claro' }))
    await usuario.click(screen.getByRole('button', { name: 'Densidade compacta' }))
    tela.unmount()

    render(<ThemeProvider><ConfiguracoesUsuario aoFechar={vi.fn()} /></ThemeProvider>)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('axe nao encontra violacao nas duas telas', async () => {
    const grupo = render(<ConfiguracoesGrupo groupId={GRUPO} aoFechar={vi.fn()} />)
    await screen.findByText('diretoria')
    expect(await violacoes(grupo.container)).toEqual([])
    grupo.unmount()

    const conta = render(
      <ThemeProvider><ConfiguracoesUsuario aoFechar={vi.fn()} /></ThemeProvider>,
    )
    await screen.findByText('Firefox 142 / Windows')
    expect(await violacoes(conta.container)).toEqual([])
  })
})
