import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useDensity, useTheme } from '../src/ui/ThemeProvider.js'
import { DARK, LIGHT } from '../src/ui/tokens.js'

function Painel() {
  const { theme, setTheme } = useTheme()
  const { density, setDensity } = useDensity()
  return (
    <div>
      <span data-testid="estado">{theme}/{density}</span>
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>trocar tema</button>
      <button onClick={() => setDensity('compact')}>compactar</button>
    </div>
  )
}

const varDe = (nome: string): string =>
  document.documentElement.style.getPropertyValue(nome).trim()

describe('tema e densidade', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
  })

  it('nasce escuro e escreve a paleta no elemento raiz', () => {
    render(<ThemeProvider><Painel /></ThemeProvider>)
    expect(screen.getByTestId('estado')).toHaveTextContent('dark/comfortable')
    expect(varDe('--color-bg')).toBe(DARK.bg)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('trocar o tema reescreve as variaveis e persiste a escolha', async () => {
    const usuario = userEvent.setup()
    render(<ThemeProvider><Painel /></ThemeProvider>)

    await usuario.click(screen.getByRole('button', { name: 'trocar tema' }))
    expect(varDe('--color-bg')).toBe(LIGHT.bg)
    expect(varDe('--color-accent')).toBe(LIGHT.accent)
    expect(localStorage.getItem('altcast:tema')).toBe('light')
  })

  it('densidade muda espacamento sem tocar na cor', async () => {
    const usuario = userEvent.setup()
    render(<ThemeProvider><Painel /></ThemeProvider>)
    const antes = varDe('--color-bg')

    await usuario.click(screen.getByRole('button', { name: 'compactar' }))
    expect(varDe('--space-row')).toBe('0.25rem')
    expect(varDe('--color-bg')).toBe(antes)
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('a escolha guardada vence a preferencia do sistema', () => {
    localStorage.setItem('altcast:tema', 'light')
    render(<ThemeProvider><Painel /></ThemeProvider>)
    // Sobrescrever uma decisao consciente com a do sistema operacional seria
    // desfazer o que a pessoa acabou de pedir.
    expect(screen.getByTestId('estado')).toHaveTextContent('light/')
  })

  it('usar os ganchos fora do provedor falha alto, nao em silencio', () => {
    expect(() => render(<Painel />)).toThrow(/ThemeProvider/)
  })
})
