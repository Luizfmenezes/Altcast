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

describe('telas de autenticacao', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('login tem rotulos persistentes, nao apenas placeholder', () => {
    render(<Login aoEntrar={vi.fn()} />)
    // Rotulo que some ao digitar deixa quem voltou ao formulario sem saber o
    // que cada campo pedia.
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  it('erro aparece em texto e devolve o foco ao campo', async () => {
    const usuario = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(json(401, {
      error: { code: 'invalid_credentials', message: 'E-mail ou senha incorretos.', requestId: 'r' },
    }))

    render(<Login aoEntrar={vi.fn()} />)
    await usuario.type(screen.getByLabelText('E-mail'), 'a@x.com')
    await usuario.type(screen.getByLabelText('Senha'), 'errada')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    // Nunca apenas borda vermelha (SC 1.4.1); o texto diz o que houve.
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
  })

  it('previa de convite mostra nome e contagem, e nada mais', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, PREVIA_VALIDA))
    const { container } = render(<PreviaConvite codigo="K7M2P9XQ" aoEntrar={vi.fn()} />)

    expect(await screen.findByText('Anticorp')).toBeInTheDocument()
    expect(screen.getByText(/12 membros/)).toBeInTheDocument()

    // Nenhum canal, nenhum nome de membro, nenhum ID interno: a previa e a
    // unica resposta nao autenticada com dado de grupo.
    const texto = container.textContent ?? ''
    expect(texto).not.toMatch(/geral|diretoria/)
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('convite invalido explica o motivo em portugues', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, { valid: false, reason: 'expired' }))
    render(<PreviaConvite codigo="K7M2P9XQ" aoEntrar={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Este convite expirou.')
    expect(screen.queryByText('invite_expired')).not.toBeInTheDocument()
    expect(screen.queryByText('expired')).not.toBeInTheDocument()
  })

  it('o codigo aparece em monoespacada, para ser ditado sem erro', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, PREVIA_VALIDA))
    render(<PreviaConvite codigo="K7M2P9XQ" aoEntrar={vi.fn()} />)

    const codigo = await screen.findByText('K7M2P9XQ')
    expect(codigo.tagName).toBe('CODE')
  })

  it('cadastro preserva o codigo ao alternar com o login', async () => {
    const usuario = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(json(200, PREVIA_VALIDA))
    render(<TelaAuth codigoInicial="K7M2P9XQ" aoEntrar={vi.fn()} />)

    await usuario.click(await screen.findByRole('button', { name: 'Criar conta' }))
    expect(screen.getByLabelText('Nome de exibicao')).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: 'Ja tenho conta' }))
    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }))
    // Perder o codigo na ida e volta obrigaria a pessoa a reabrir o link.
    expect(screen.getByText('K7M2P9XQ')).toBeInTheDocument()
  })

  it('sem codigo no contexto o cadastro nem e oferecido', () => {
    render(<TelaAuth aoEntrar={vi.fn()} />)
    // Cadastro fechado por convite: oferecer o formulario e depois recusar
    // seria prometer o que o servidor nao entrega.
    expect(screen.queryByRole('button', { name: 'Criar conta' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
  })

  it('axe nao encontra violacao nas tres telas', async () => {
    vi.mocked(fetch).mockResolvedValue(json(200, PREVIA_VALIDA))
    const usuario = userEvent.setup()

    const login = render(<TelaAuth aoEntrar={vi.fn()} />)
    expect(await violacoes(login.container)).toEqual([])
    login.unmount()

    const convite = render(<TelaAuth codigoInicial="K7M2P9XQ" aoEntrar={vi.fn()} />)
    await screen.findByText('Anticorp')
    expect(await violacoes(convite.container)).toEqual([])

    await usuario.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await violacoes(convite.container)).toEqual([])
  })
})
