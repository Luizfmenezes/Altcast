import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from '../src/features/messages/Composer.js'
import { MessageList } from '../src/features/messages/MessageList.js'
import { useRascunhos } from '../src/features/messages/rascunhos.js'
import { useHistorico } from '../src/features/messages/historico.js'
import { candidatosDeMencao } from '../src/features/messages/Mencoes.js'
import { reenviarMensagem } from '../src/features/messages/envio.js'
import { TelaAuth } from '../src/features/auth/TelaAuth.js'
import { VerificarEmail } from '../src/features/auth/VerificarEmail.js'
import { RedefinirSenha } from '../src/features/auth/RedefinirSenha.js'
import { AceitarConvite } from '../src/features/groups/AceitarConvite.js'
import { PainelDoUsuario } from '../src/features/settings/PainelDoUsuario.js'
import { BarraDeChamada } from '../src/features/voice/BarraDeChamada.js'
import { situacaoDaChamada } from '../src/features/voice/situacao.js'
import { useChamadaAtiva, zerarChamadaParaTeste } from '../src/features/voice/chamadaAtiva.js'
import { ESTADO_INICIAL } from '../src/lib/midia.js'
import { SESSAO_EXPIROU } from '../src/lib/api.js'
import { caminhoDe, lerRota } from '../src/lib/rota.js'
import { descreverAparelho, haQuanto } from '../src/lib/userAgent.js'
import { useStore } from '../src/lib/store.js'
import type { Mensagem, Ready } from '../src/lib/tipos.js'

/**
 * Os dezesseis defeitos da Etapa 0 do super plano, um teste por defeito.
 *
 * Cada `describe` nomeia o bug (B1–B16) do documento
 * `docs/propostas/2026-09-26-super-plano-tot.md`, para que a regressao aponte
 * direto para o motivo de a regra existir.
 */

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'content-type': 'application/json' },
  })
}

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [
    { id: 'g1', name: 'Anticorp', iconUrl: null, role: 'member' },
    { id: 'g2', name: 'Estudos', iconUrl: null, role: 'member' },
  ],
  channels: [
    { id: 'c1', groupId: 'g1', name: 'geral', type: 'text', visibility: 'public', topic: null, position: 0 },
    { id: 'c2', groupId: 'g1', name: 'avisos', type: 'text', visibility: 'public', topic: null, position: 1 },
    { id: 'c9', groupId: 'g2', name: 'calculo', type: 'text', visibility: 'public', topic: null, position: 0 },
  ],
  members: [
    { groupId: 'g1', userId: 'u1', displayName: 'Felipe', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: 'g1', userId: 'u2', displayName: 'Ana', avatarUrl: null, role: 'member', status: 'online' },
    { groupId: 'g2', userId: 'u3', displayName: 'Antônio', avatarUrl: null, role: 'member', status: 'online' },
  ],
  serverTime: '2026-09-26T12:00:00.000Z',
}

function idEm(ms: number, sufixo: number): string {
  const hex = ms.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-${String(sufixo).padStart(12, '0')}`
}

function msg(n: number, extras: Partial<Mensagem> = {}): Mensagem {
  const ms = Date.parse('2026-09-26T12:00:00.000Z') + n * 60_000
  return {
    id: idEm(ms, n), channelId: 'c1', authorId: 'u2', content: `mensagem ${String(n)}`,
    createdAt: new Date(ms).toISOString(), editedAt: null, ...extras,
  }
}

function preparar(): void {
  act(() => {
    useStore.getState().limpar()
    useStore.getState().aplicarReady(READY)
    useStore.getState().escolherCanal('c1')
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, {}))))
  preparar()
})
afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('B1 · o rascunho pertence ao canal', () => {
  it('trocar de canal troca o texto, e voltar o devolve', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)

    await pessoa.type(screen.getByLabelText('Escrever mensagem'), 'para o geral')
    act(() => { useStore.getState().escolherCanal('c2') })
    expect(screen.getByLabelText('Escrever mensagem')).toHaveValue('')

    act(() => { useStore.getState().escolherCanal('c1') })
    expect(screen.getByLabelText('Escrever mensagem')).toHaveValue('para o geral')
  })

  it('Enter depois de trocar de canal nunca manda o texto do canal anterior', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    await pessoa.type(screen.getByLabelText('Escrever mensagem'), 'segredo do geral')
    act(() => { useStore.getState().escolherCanal('c2') })

    await pessoa.type(screen.getByLabelText('Escrever mensagem'), '{Enter}')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a citação também fica no canal em que foi feita', () => {
    act(() => {
      useRascunhos.getState().definirResposta('c1', { id: 'm1', autor: 'Ana', trecho: 'oi' })
    })
    render(<Composer campo={{ current: null }} />)
    expect(screen.getByText(/Respondendo a/)).toBeInTheDocument()

    act(() => { useStore.getState().escolherCanal('c2') })
    expect(screen.queryByText(/Respondendo a/)).not.toBeInTheDocument()
  })

  it('o anexo pronto de um canal não aparece no composer de outro', () => {
    act(() => {
      useRascunhos.getState().acrescentarEnvio({
        chave: 'x', channelId: 'c1', nome: 'foto.png', tamanho: 10, progresso: 1,
        anexo: { id: 'a1' } as never, erro: null,
      })
    })
    render(<Composer campo={{ current: null }} />)
    expect(screen.getByText('foto.png')).toBeInTheDocument()

    act(() => { useStore.getState().escolherCanal('c2') })
    expect(screen.queryByText('foto.png')).not.toBeInTheDocument()
  })

  it('o rascunho sobrevive a um F5 na mesma aba', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    await pessoa.type(screen.getByLabelText('Escrever mensagem'), 'quase pronto')

    const guardado = JSON.parse(sessionStorage.getItem('altcast:rascunhos') ?? '{}') as {
      rascunhos: Record<string, { texto: string }>
    }
    expect(guardado.rascunhos['c1']?.texto).toBe('quase pronto')
  })
})

describe('B2 · menções só do grupo do canal, com teclado de verdade', () => {
  it('não oferece gente de outro grupo', () => {
    const nomes = candidatosDeMencao(READY.members, 'g1', 'an', 'u1').map(m => m.displayName)
    expect(nomes).toEqual(['Ana'])
  })

  it('ignora acento e acha o começo de qualquer palavra', () => {
    const membros = [
      ...READY.members,
      { groupId: 'g1', userId: 'u4', displayName: 'Maria João', avatarUrl: null, role: 'member' as const, status: 'online' as const },
    ]
    expect(candidatosDeMencao(membros, 'g1', 'joao', 'u1').map(m => m.displayName)).toEqual(['Maria João'])
  })

  it('Enter completa em vez de mandar o "@An" cru', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    const campo = screen.getByLabelText('Escrever mensagem')

    await pessoa.type(campo, 'oi @An{Enter}')
    expect(campo).toHaveValue('oi @Ana ')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('as setas movem a opção ativa, e o campo acompanha por aria-activedescendant', async () => {
    const membros = [
      ...READY.members,
      { groupId: 'g1', userId: 'u5', displayName: 'Anabela', avatarUrl: null, role: 'member' as const, status: 'online' as const },
    ]
    act(() => { useStore.setState({ members: membros }) })
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    const campo = screen.getByLabelText('Escrever mensagem')

    await pessoa.type(campo, '@An')
    const [ana, anabela] = screen.getAllByRole('option')
    expect(campo).toHaveAttribute('aria-activedescendant', ana!.id)
    await pessoa.keyboard('{ArrowDown}')
    expect(campo).toHaveAttribute('aria-activedescendant', anabela!.id)
    await pessoa.keyboard('{Tab}')
    expect(campo).toHaveValue('@Anabela ')
  })

  it('Esc fecha a lista sem apagar o texto', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    const campo = screen.getByLabelText('Escrever mensagem')
    await pessoa.type(campo, '@An')
    await pessoa.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(campo).toHaveValue('@An')
  })

  it('a lista vem DEPOIS do campo no DOM', async () => {
    const pessoa = userEvent.setup()
    render(<Composer campo={{ current: null }} />)
    const campo = screen.getByLabelText('Escrever mensagem')
    await pessoa.type(campo, '@An')
    const lista = screen.getByRole('listbox')
    // DOCUMENT_POSITION_FOLLOWING: a lista segue o campo na ordem de leitura.
    expect(campo.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('B3 e B4 · as telas de sucesso aparecem, com ou sem sessão', () => {
  it('"E-mail confirmado" fica na tela e o token sai da barra', async () => {
    history.replaceState(null, '', '/verificar/abc')
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    render(<TelaAuth aoEntrar={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: /CONFIRMADO/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/entrar')
    // A tela nao trocou sozinha para o login: so o "Continuar" leva adiante.
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument()
  })

  it('com sessão, confirmar leva de volta ao aplicativo e apaga a faixa', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    act(() => { useStore.setState({ user: { ...READY.user, emailVerifiedAt: null } }) })
    render(<VerificarEmail token="abc" comSessao />)

    expect(await screen.findByRole('button', { name: 'Voltar ao Altcast' })).toBeInTheDocument()
    expect(useStore.getState().user?.emailVerifiedAt).toBeTruthy()
    expect(window.location.pathname).toBe('/')
  })

  it('"Senha trocada" fica na tela até a pessoa decidir entrar', async () => {
    const pessoa = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    render(<RedefinirSenha token="abc" />)
    await pessoa.type(screen.getByLabelText('Senha'), 'uma frase longa de verdade')
    await pessoa.click(screen.getByRole('button', { name: 'Trocar senha' }))

    expect(await screen.findByRole('heading', { name: /TROCADA/ })).toBeInTheDocument()
    const expirou = vi.fn()
    window.addEventListener(SESSAO_EXPIROU, expirou)
    await pessoa.click(screen.getByRole('button', { name: 'Entrar' }))
    window.removeEventListener(SESSAO_EXPIROU, expirou)
    // As sessoes todas cairam; a desta aba tambem, se havia uma.
    expect(expirou).toHaveBeenCalledTimes(1)
  })
})

describe('B5 · o convite atravessa o login', () => {
  it('"Já tenho conta" leva o código junto e o login mostra o grupo', async () => {
    const pessoa = userEvent.setup()
    vi.mocked(fetch).mockImplementation((entrada: RequestInfo | URL) => {
      const url = String(entrada)
      if (url.includes('/auth/providers')) return Promise.resolve(json(200, { google: false }))
      return Promise.resolve(json(200, {
        valid: true, groupName: 'Clube do Livro', groupIconUrl: null, memberCount: 4,
      }))
    })
    history.replaceState(null, '', '/convite/K7M2P9XQ')
    render(<TelaAuth aoEntrar={vi.fn()} />)

    await pessoa.click(await screen.findByRole('button', { name: 'Já tenho conta' }))

    expect(window.location.pathname + window.location.search).toBe('/entrar?convite=K7M2P9XQ')
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    const cartao = await screen.findByRole('region', { name: 'Convite' })
    expect(cartao).toHaveTextContent('Entre para aceitar o convite de')
    expect(cartao).toHaveTextContent('Clube do Livro')
  })

  it('a rota guarda e devolve o convite', () => {
    expect(lerRota({ pathname: '/entrar', search: '?convite=K7M2P9XQ' }))
      .toEqual({ nome: 'entrar', convite: 'K7M2P9XQ' })
    expect(caminhoDe({ nome: 'criar-conta', convite: 'K7M2P9XQ' })).toBe('/criar-conta?convite=K7M2P9XQ')
    expect(lerRota({ pathname: '/', search: '' })).toEqual({ nome: 'app' })
    // O link antigo continua valendo.
    expect(lerRota({ pathname: '/', search: '?convite=K7M2P9XQ' }))
      .toEqual({ nome: 'convite', codigo: 'K7M2P9XQ' })
  })

  it('o Google leva o convite na ida', async () => {
    vi.mocked(fetch).mockImplementation((entrada: RequestInfo | URL) => {
      const url = String(entrada)
      if (url.includes('/auth/providers')) return Promise.resolve(json(200, { google: true }))
      return Promise.resolve(json(200, { valid: true, groupName: 'X', groupIconUrl: null, memberCount: 1 }))
    })
    history.replaceState(null, '', '/entrar?convite=K7M2P9XQ')
    render(<TelaAuth aoEntrar={vi.fn()} />)
    const link = await screen.findByRole('link', { name: /Google/ })
    expect(link).toHaveAttribute('href', '/api/auth/google/start?convite=K7M2P9XQ')
  })
})

describe('B6 · "Tentar de novo" manda tudo de novo', () => {
  it('o reenvio leva anexos e citação', async () => {
    const falha = msg(5, {
      authorId: 'u1', envio: 'falhou', replyToId: msg(1).id,
      attachments: [{ id: 'anexo-1' } as never],
    })
    vi.mocked(fetch).mockResolvedValue(json(201, { ...falha, envio: undefined }))
    await reenviarMensagem(falha)

    const corpo = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)) as {
      id: string; attachmentIds: string[]; replyToId: string
    }
    expect(corpo).toMatchObject({ id: falha.id, attachmentIds: ['anexo-1'], replyToId: msg(1).id })
  })

  it('409 no mesmo id e sucesso atrasado, e não falha', async () => {
    const eco = msg(6, { authorId: 'u1', envio: 'falhou' })
    act(() => { useStore.getState().registrarEco(eco) })
    vi.mocked(fetch).mockResolvedValue(json(409, {
      error: { code: 'message_id_taken', message: 'Esta mensagem já foi enviada.' },
    }))
    await reenviarMensagem(eco)
    const salva = useStore.getState().mensagens['c1']!.find(m => m.id === eco.id)
    expect(salva?.envio).toBeUndefined()
  })
})

describe('B7 · paginação com trava e com a leitura no lugar', () => {
  it('rolar até o topo pede UMA página anterior, e a antiga não vira "nova"', async () => {
    const primeiras = Array.from({ length: 50 }, (_, i) => msg(i + 100))
    act(() => {
      useStore.getState().carregarMensagens('c1', primeiras)
      useHistorico.getState().mexer('c1', { primeira: 'pronto' })
    })
    let responder: (r: Response) => void = () => undefined
    vi.mocked(fetch).mockImplementation(() => new Promise(r => { responder = r }))

    render(<MessageList escrevendo={false} />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 5000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(log, 'scrollTop', { value: 0, writable: true, configurable: true })
    act(() => {
      log.dispatchEvent(new Event('scroll'))
      log.dispatchEvent(new Event('scroll'))
      log.dispatchEvent(new Event('scroll'))
    })
    // A trava: tres eventos de rolagem, um pedido de pagina so. (O `PUT` do
    // marco de leitura tambem passa pelo `fetch`, e nao entra na conta.)
    const paginas = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(u => u.includes('before='))
    expect(paginas).toEqual([`/api/channels/c1/messages?before=${primeiras[0]!.id}&limit=50`])

    const antigas = Array.from({ length: 50 }, (_, i) => msg(i + 1)).reverse()
    await act(async () => { responder(json(200, antigas)); await Promise.resolve() })
    await waitFor(() => expect(useStore.getState().mensagens['c1']).toHaveLength(100))
    expect(screen.queryByRole('button', { name: 'Novas mensagens' })).not.toBeInTheDocument()
  })

  it('histórico que não carregou diz isso, com saída', async () => {
    act(() => {
      useStore.setState({ mensagens: {} })
      useHistorico.getState().mexer('c1', { primeira: 'falhou' })
    })
    render(<MessageList escrevendo={false} />)
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Não foi possível carregar')
    expect(within(alerta).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    expect(screen.queryByText(/Nenhuma mensagem ainda/)).not.toBeInTheDocument()
  })
})

describe('B11 e B13 · painel do usuário', () => {
  it('"Sair" encerra a sessão no servidor e volta à porta de entrada', async () => {
    const pessoa = userEvent.setup()
    const expirou = vi.fn()
    window.addEventListener(SESSAO_EXPIROU, expirou)
    render(<PainelDoUsuario />)

    await pessoa.click(screen.getByRole('button', { name: 'Conta de Felipe' }))
    await pessoa.click(await screen.findByRole('menuitem', { name: 'Sair' }))

    await waitFor(() => expect(expirou).toHaveBeenCalledTimes(1))
    window.removeEventListener(SESSAO_EXPIROU, expirou)
    const chamadas = vi.mocked(fetch).mock.calls.map(([url, opcoes]) => [String(url), opcoes?.method])
    expect(chamadas).toContainEqual(['/api/auth/logout', 'POST'])
  })

  it('quem convida por cargo acha a administração do grupo', async () => {
    const pessoa = userEvent.setup()
    act(() => {
      useStore.setState({
        cargos: {
          r1: { id: 'r1', groupId: 'g1', name: 'Recepção', color: null, position: 1, permissions: ['group.invite'], isDefault: false },
        },
        cargosDoMembro: { 'g1:u1': ['r1'] },
      })
    })
    render(<PainelDoUsuario />)
    await pessoa.click(screen.getByRole('button', { name: 'Configurações' }))
    // O papel e `member`; a permissao veio do cargo — e e ela que decide.
    expect(await screen.findByRole('tab', { name: /Grupo/ })).toBeInTheDocument()
  })
})

describe('B14 e B16 · aceitar convite', () => {
  it('os dois botões ficam numa grade de duas colunas', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, {
      valid: true, groupName: 'Clube do Livro', groupIconUrl: null, memberCount: 4,
    }))
    render(<AceitarConvite codigo="K7M2P9XQ" />)
    const entrar = await screen.findByRole('button', { name: 'Entrar' })
    expect(entrar.parentElement).toHaveClass('grid', 'grid-cols-2')
  })

  it('já ser membro abre o grupo PELO ID, mesmo com nomes repetidos', async () => {
    const pessoa = userEvent.setup()
    act(() => {
      useStore.setState({
        groups: [
          { id: 'g1', name: 'Amigos', iconUrl: null, role: 'member' },
          { id: 'g2', name: 'Amigos', iconUrl: null, role: 'member' },
        ],
      })
    })
    vi.mocked(fetch).mockImplementation((_e: RequestInfo | URL, opcoes?: RequestInit) => Promise.resolve(
      opcoes?.method === 'POST'
        ? json(409, { error: { code: 'already_member', message: '...', details: { groupId: 'g2' } } })
        : json(200, { valid: true, groupName: 'Amigos', groupIconUrl: null, memberCount: 3 }),
    ))
    render(<AceitarConvite codigo="K7M2P9XQ" />)
    await pessoa.click(await screen.findByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(useStore.getState().grupoAtivo).toBe('g2'))
  })

  it('no modo automático aceita sozinho, sem perguntar de novo', async () => {
    vi.mocked(fetch).mockImplementation((_e: RequestInfo | URL, opcoes?: RequestInit) => Promise.resolve(
      opcoes?.method === 'POST'
        ? json(200, { group: { id: 'g2' } })
        : json(200, { valid: true, groupName: 'Estudos', groupIconUrl: null, memberCount: 3 }),
    ))
    render(<AceitarConvite codigo="K7M2P9XQ" automatico />)
    await waitFor(() => expect(useStore.getState().grupoAtivo).toBe('g2'))
    expect(window.location.pathname).toBe('/')
  })
})

describe('B15 · a chamada tem um estado só', () => {
  afterEach(() => { zerarChamadaParaTeste() })

  it('a situação deriva do mesmo estado para a barra e o painel', () => {
    expect(situacaoDaChamada(null, ESTADO_INICIAL)).toBe('ocioso')
    expect(situacaoDaChamada('v', { ...ESTADO_INICIAL, fase: 'entrando' })).toBe('conectando')
    expect(situacaoDaChamada('v', { ...ESTADO_INICIAL, fase: 'dentro' })).toBe('conectado')
    expect(situacaoDaChamada('v', { ...ESTADO_INICIAL, fase: 'dentro', reconectando: true })).toBe('reconectando')
    expect(situacaoDaChamada('v', { ...ESTADO_INICIAL, fase: 'erro' })).toBe('falhou')
  })

  it('entrada que falhou nunca aparece como "no ar", e oferece tentar de novo', () => {
    act(() => {
      useChamadaAtiva.setState({
        canal: 'c1',
        chamada: { ...ESTADO_INICIAL, fase: 'erro', erro: 'Não foi possível conectar ao servidor de mídia.' },
      })
    })
    render(<BarraDeChamada />)
    expect(screen.queryByText(/No ar/)).not.toBeInTheDocument()
    expect(screen.getByText(/Falha na chamada/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('servidor de mídia')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    // Sem sala nao ha microfone para mostrar como ligado.
    expect(screen.queryByRole('button', { name: /Microfone/ })).not.toBeInTheDocument()
  })
})

describe('0.10 · sessões legíveis', () => {
  it('traduz o user-agent em algo que se reconhece', () => {
    expect(descreverAparelho(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    )).toBe('Chrome no Windows')
    expect(descreverAparelho(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
    )).toBe('Edge no Windows')
    expect(descreverAparelho(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    )).toBe('Safari no macOS')
    expect(descreverAparelho(null)).toBe('Aparelho desconhecido')
  })

  it('diz há quanto tempo em palavras', () => {
    const agora = Date.parse('2026-09-26T12:00:00Z')
    expect(haQuanto('2026-09-26T11:59:40Z', agora)).toBe('agora')
    expect(haQuanto('2026-09-26T11:55:00Z', agora)).toBe('há 5 minutos')
    expect(haQuanto('2026-09-25T12:00:00Z', agora)).toBe('ontem')
  })
})
