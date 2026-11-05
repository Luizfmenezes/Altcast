import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AtualizacaoDoApp } from '../src/features/settings/AtualizacaoDoApp.js'
import {
  definirNativoParaTeste, esquecerNativoParaTeste, naoNativoParaTeste,
} from '../src/lib/nativo.js'
import type { EstadoDaAtualizacao } from '../src/lib/nativo.js'

function ponteCom(estado: EstadoDaAtualizacao): {
  procurar: ReturnType<typeof vi.fn>
  emitir: (e: EstadoDaAtualizacao) => void
} {
  let ouvinte: ((e: EstadoDaAtualizacao) => void) | null = null
  const procurar = vi.fn(() => Promise.resolve())
  definirNativoParaTeste({
    versao: '2',
    listarFontes: () => Promise.resolve([]),
    escolherFonte: () => Promise.resolve(),
    atualizacao: {
      ler: () => Promise.resolve({ versao: '0.3.0', estado }),
      procurar,
      aoMudar: fn => {
        ouvinte = fn
        return () => { ouvinte = null }
      },
    },
  })
  return { procurar, emitir: e => { act(() => { ouvinte?.(e) }) } }
}

afterEach(() => { esquecerNativoParaTeste() })

describe('a atualizacao do app de Windows, em Configuracoes', () => {
  it('mostra a versao e acompanha o download ate ficar pronta', async () => {
    const { emitir } = ponteCom({ fase: 'em-dia' })
    render(<AtualizacaoDoApp />)

    expect(await screen.findByText('Versão 0.3.0')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Você está na versão mais recente.')

    emitir({ fase: 'baixando', versao: '0.3.1', progresso: 37 })
    expect(screen.getByRole('status')).toHaveTextContent('Baixando a versão 0.3.1… 37%')
    expect(screen.getByRole('button', { name: 'Procurar atualização' })).toBeDisabled()

    // Pronta: nada para clicar — instala sozinha ao fechar.
    emitir({ fase: 'pronta', versao: '0.3.1' })
    expect(screen.getByRole('status')).toHaveTextContent('instalada sozinha quando você fechar o Altcast')
    expect(screen.queryByRole('button', { name: 'Procurar atualização' })).not.toBeInTheDocument()
  })

  it('procurar agora chama o processo principal', async () => {
    const { procurar } = ponteCom({ fase: 'parado' })
    const pessoa = userEvent.setup()
    render(<AtualizacaoDoApp />)
    await pessoa.click(await screen.findByRole('button', { name: 'Procurar atualização' }))
    expect(procurar).toHaveBeenCalledOnce()
  })

  it('no navegador nao aparece', () => {
    naoNativoParaTeste()
    const { container } = render(<AtualizacaoDoApp />)
    expect(container).toBeEmptyDOMElement()
  })
})
