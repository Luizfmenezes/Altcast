import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Anexos } from '../src/features/messages/Anexos.js'
import { formatarTamanho, urlDaMiniatura, urlDoAnexo } from '../src/lib/anexos.js'
import { violacoes } from './helpers/axe.js'
import type { Anexo } from '../src/lib/tipos.js'

const base: Anexo = {
  id: 'a1', channelId: 'c1', messageId: 'm1',
  filename: 'foto.png', contentType: 'image/png', byteSize: 2048,
  width: 800, height: 600, temMiniatura: true, reproduzivel: true,
  createdAt: '2026-08-29T12:00:00.000Z',
}

const anexo = (campos: Partial<Anexo>): Anexo => ({ ...base, ...campos })

describe('tamanho legivel', () => {
  it('escolhe a unidade e a casa decimal que informam alguma coisa', () => {
    expect(formatarTamanho(512)).toBe('512 B')
    expect(formatarTamanho(2048)).toBe('2.0 KB')
    expect(formatarTamanho(1_500_000)).toBe('1.4 MB')
    // Acima de dez, a casa decimal so ocupa espaco.
    expect(formatarTamanho(52_428_800)).toBe('50 MB')
  })
})

describe('como cada anexo aparece', () => {
  it('imagem usa a miniatura, e nao o original de vinte megabytes', () => {
    render(<Anexos anexos={[anexo({})]} />)
    const img = screen.getByAltText('foto.png')
    expect(img).toHaveAttribute('src', urlDaMiniatura('a1'))
    // As dimensoes reais reservam o espaco: sem elas a conversa pula sob o
    // dedo de quem esta lendo quando a imagem chega.
    expect(img).toHaveAttribute('width', '800')
    // O original abre em aba nova, sob a mesma checagem de permissao.
    expect(img.closest('a')).toHaveAttribute('href', urlDoAnexo('a1'))
  })

  it('imagem sem miniatura cai no original em vez de sumir', () => {
    render(<Anexos anexos={[anexo({ temMiniatura: false })]} />)
    expect(screen.getByAltText('foto.png')).toHaveAttribute('src', urlDoAnexo('a1'))
  })

  it('video toca na conversa, carregando so os metadados', () => {
    render(<Anexos anexos={[anexo({
      filename: 'clipe.mp4', contentType: 'video/mp4', temMiniatura: false,
    })]} />)
    // `metadata` mostra o primeiro quadro sem baixar o video inteiro — o
    // motivo de nao existir miniatura de video gerada no servidor.
    expect(screen.getByLabelText('clipe.mp4')).toHaveAttribute('preload', 'metadata')
  })

  it('PDF vira cartao de download, com nome e tamanho', () => {
    render(<Anexos anexos={[anexo({
      filename: 'contrato.pdf', contentType: 'application/pdf',
      byteSize: 1_500_000, reproduzivel: false, temMiniatura: false,
      width: null, height: null,
    })]} />)
    expect(screen.getByText('contrato.pdf')).toBeInTheDocument()
    expect(screen.getByText('1.4 MB')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  /**
   * A regressao de seguranca que importa no cliente.
   *
   * O servidor detecta o tipo pelos bytes e devolve `reproduzivel: false` para
   * o que ninguem reconheceu. Se a interface decidisse pelo NOME do arquivo,
   * um executavel chamado `gatinho.png` voltaria a ser renderizado — e a
   * deteccao no servidor teria sido feita para nada.
   */
  it('arquivo com nome de imagem, mas tipo de octetos, nao renderiza como imagem', () => {
    render(<Anexos anexos={[anexo({
      filename: 'gatinho.png', contentType: 'application/octet-stream',
      reproduzivel: false, temMiniatura: false, width: null, height: null,
    })]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('gatinho.png')).toBeInTheDocument()
  })

  it('SVG tambem cai no cartao, nunca em img', () => {
    render(<Anexos anexos={[anexo({
      filename: 'desenho.svg', contentType: 'application/octet-stream',
      reproduzivel: false, temMiniatura: false, width: null, height: null,
    })]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('mensagem sem anexo nao deixa lista vazia na tela', () => {
    const { container } = render(<Anexos anexos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('axe nao encontra violacao nos tres formatos juntos', async () => {
    const { container } = render(<Anexos anexos={[
      anexo({}),
      anexo({ id: 'a2', filename: 'clipe.mp4', contentType: 'video/mp4', temMiniatura: false }),
      anexo({
        id: 'a3', filename: 'contrato.pdf', contentType: 'application/pdf',
        reproduzivel: false, temMiniatura: false, width: null, height: null,
      }),
    ]} />)
    expect(await violacoes(container)).toEqual([])
  })
})
