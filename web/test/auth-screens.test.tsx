import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { violacoes } from './helpers/axe.js'
import { TelaAuth } from '../src/features/auth/TelaAuth.js'
import { Login } from '../src/features/auth/Login.js'
import { PreviaConvite } from '../src/features/auth/PreviaConvite.js'

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'content-type': 'application/json' },
  })
}

const PREVIA_VALIDA = {
  valid: true, groupName: 'Anticorp', groupIconUrl: null, memberCount: 12,
}

/**
 * Responde a TODA requisicao com um corpo novo.
 *
 * `mockResolvedValue(json(...))` devolveria a MESMA instancia de `Response` a
 * cada chamada, e o corpo de uma `Response` so pode ser lido uma vez: a
 * segunda requisicao da tela receberia um corpo ja consumido e cairia no erro
 * generico. A tela de entrada passou a fazer duas — `/auth/providers`, para
 * saber se desenha o botao do Google, e a do proprio formulario —, e um mock
 * de instancia unica nao sobrevive a isso.
 *
 * `/auth/providers` responde separadamente porque nao e o assunto de nenhum
 * destes testes: sem o Google configurado, o botao nao existe e as telas ficam
 * exatamente como estavam.
 */
function respondendo(status: number, corpo: unknown): void {
  vi.mocked(fetch).mockImplementation((entrada: RequestInfo | URL) => {
    const url = typeof entrada === 'string' ? entrada : entrada.toString()
    if (url.includes('/auth/providers')) return Promise.resolve(json(200, { google: false }))
    return Promise.resolve(json(status, corpo))
  })
}

/**
 * Qual tela aparece passou a ser decidido pela URL, e nao por uma propriedade:
 * recuperacao de senha e confirmacao de e-mail chegam por link, e precisam
 * existir como endereco. Cada teste posiciona a rota antes de montar.
 */
function estarEm(caminho: string): void {
  history.replaceState(null, '', caminho)
}

describe('telas de autenticacao', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    estarEm('/entrar')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    estarEm('/')
  })

  it('o botão do Google e um link, e só existe onde o servidor o oferece', async () => {
    // Um `<a href>`, e nao um botao com `fetch`: o fluxo vive em
    // redirecionamentos de servidor, e e por isso que a sessao volta para
    // DENTRO da janela do aplicativo de desktop.
    respondendo(200, {})
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(json(200, { google: true })))

    render(<Login aoEntrar={vi.fn()} />)
    const link = await screen.findByRole('link', { name: 'Entrar com Google' })
    expect(link).toHaveAttribute('href', '/api/auth/google/start')
  })

  it('sem Google configurado, a tela de entrada fica como estava', async () => {
    respondendo(200, {})
    render(<Login aoEntrar={vi.fn()} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /Google/ })).not.toBeInTheDocument()
  })

  it('a falha do Google volta pela URL e aparece como aviso', async () => {
    // O callback e uma navegacao de servidor: quem chega depois de um erro
    // chegou por `Location:`, e nao por uma resposta que o cliente possa ler.
    estarEm('/entrar?erro=google')
    respondendo(200, {})
    render(<Login aoEntrar={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Google/)
  })

  it('login tem rotulos persistentes, não apenas placeholder', () => {
    render(<Login aoEntrar={vi.fn()} />)
    // Rotulo que some ao digitar deixa quem voltou ao formulario sem saber o
    // que cada campo pedia.
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  it('erro aparece em texto e devolve o foco ao campo', async () => {
    const usuario = userEvent.setup()
    respondendo(401, {
      error: { code: 'invalid_credentials', message: 'E-mail ou senha incorretos.', requestId: 'r' },
    })

    render(<Login aoEntrar={vi.fn()} />)
    await usuario.type(screen.getByLabelText('E-mail'), 'a@x.com')
    await usuario.type(screen.getByLabelText('Senha'), 'errada')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    // Nunca apenas borda vermelha (SC 1.4.1); o texto diz o que houve.
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
  })

  it('prévia de convite mostra nome e contagem, e nada mais', async () => {
    respondendo(200, PREVIA_VALIDA)
    const { container } = render(<PreviaConvite codigo="K7M2P9XQ" />)

    expect(await screen.findByText('Anticorp')).toBeInTheDocument()
    expect(screen.getByText(/12 membros/)).toBeInTheDocument()

    // Nenhum canal, nenhum nome de membro, nenhum ID interno: a previa e a
    // unica resposta nao autenticada com dado de grupo.
    const texto = container.textContent ?? ''
    expect(texto).not.toMatch(/geral|diretoria/)
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('convite inválido explica o motivo em português', async () => {
    respondendo(200, { valid: false, reason: 'expired' })
    render(<PreviaConvite codigo="K7M2P9XQ" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Este convite expirou.')
    expect(screen.queryByText('invite_expired')).not.toBeInTheDocument()
    expect(screen.queryByText('expired')).not.toBeInTheDocument()
  })

  it('o código aparece em monoespacada, para ser ditado sem erro', async () => {
    respondendo(200, PREVIA_VALIDA)
    render(<PreviaConvite codigo="K7M2P9XQ" />)

    const codigo = await screen.findByText('K7M2P9XQ')
    expect(codigo.tagName).toBe('CODE')
  })

  it('cadastro preserva o código ao alternar com o login', async () => {
    const usuario = userEvent.setup()
    respondendo(200, PREVIA_VALIDA)
    estarEm('/convite/K7M2P9XQ')
    render(<TelaAuth aoEntrar={vi.fn()} />)

    // Com convite, a previa e o cadastro aparecem juntos: quem chegou por um
    // link ja disse o que veio fazer, e uma aba a mais entre ele e a conta so
    // atrasa.
    expect(await screen.findByText('K7M2P9XQ')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Já tenho conta' }))
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  /**
   * Este teste dizia o contrario ate a abertura do cadastro. A regra antiga —
   * nao oferecer o que o servidor recusaria — continua valendo; o que mudou e
   * que o servidor deixou de recusar.
   */
  it('sem convite o cadastro e oferecido do mesmo jeito', async () => {
    const usuario = userEvent.setup()
    render(<TelaAuth aoEntrar={vi.fn()} />)

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument()
  })

  it('o login leva a recuperação de senha', async () => {
    const usuario = userEvent.setup()
    render(<TelaAuth aoEntrar={vi.fn()} />)

    await usuario.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    expect(screen.getByRole('heading', { name: /RECUPERAR/ })).toBeInTheDocument()
  })

  /**
   * A tela NUNCA diz se o endereco existe: o servidor responde igual para os
   * dois casos, e uma mensagem diferente aqui desfaria a protecao inteira.
   */
  it('o pedido de recuperação não revela se a conta existe', async () => {
    const usuario = userEvent.setup()
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    estarEm('/esqueci-a-senha')
    render(<TelaAuth aoEntrar={vi.fn()} />)

    await usuario.type(screen.getByLabelText('E-mail'), 'ninguem@x.com')
    await usuario.click(screen.getByRole('button', { name: 'Enviar link' }))

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent('Se houver uma conta')
    expect(aviso.textContent).not.toMatch(/não encontrad|inexistente|não existe/i)
  })

  it('a rota de redefinir monta o formulario de senha nova', () => {
    estarEm('/redefinir/abcdefghijklmnopqrstuvwxyz012345')
    render(<TelaAuth aoEntrar={vi.fn()} />)
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trocar senha' })).toBeInTheDocument()
  })

  it('axe não encontra violação nas três telas', async () => {
    respondendo(200, PREVIA_VALIDA)
    const usuario = userEvent.setup()

    const login = render(<TelaAuth aoEntrar={vi.fn()} />)
    expect(await violacoes(login.container)).toEqual([])
    login.unmount()

    estarEm('/convite/K7M2P9XQ')
    const convite = render(<TelaAuth aoEntrar={vi.fn()} />)
    await screen.findByText('Anticorp')
    expect(await violacoes(convite.container)).toEqual([])
    convite.unmount()

    estarEm('/esqueci-a-senha')
    const recuperar = render(<TelaAuth aoEntrar={vi.fn()} />)
    expect(await violacoes(recuperar.container)).toEqual([])
    recuperar.unmount()

    estarEm('/redefinir/abcdefghijklmnopqrstuvwxyz012345')
    const redefinir = render(<TelaAuth aoEntrar={vi.fn()} />)
    expect(await violacoes(redefinir.container)).toEqual([])
    // `usuario` continua usado abaixo; sem isto o lint reclama do import.
    void usuario
  })
})
