import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DENSIDADES, PALETAS, cssVarName, type Density, type Theme } from './tokens.js'

const CHAVE_TEMA = 'altcast:tema'
const CHAVE_DENSIDADE = 'altcast:densidade'

type Preferencias = {
  theme: Theme
  density: Density
  setTheme: (t: Theme) => void
  setDensity: (d: Density) => void
}

const Contexto = createContext<Preferencias | null>(null)

/** localStorage pode lancar em navegacao privativa; preferencia nao vale um erro. */
function lerGuardado<T extends string>(chave: string, validos: readonly T[]): T | null {
  try {
    const valor = localStorage.getItem(chave)
    return valor !== null && (validos as readonly string[]).includes(valor) ? valor as T : null
  } catch {
    return null
  }
}

function guardar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // Sem persistencia a escolha vale so para esta aba. E o suficiente.
  }
}

/**
 * Escuro por padrao, claro disponivel, e `prefers-color-scheme` respeitado na
 * primeira visita — depois disso vale a escolha explicita da pessoa, porque
 * sobrescrever uma decisao consciente com a do sistema operacional e desfazer
 * o que ela acabou de pedir.
 */
function temaInicial(): Theme {
  const guardado = lerGuardado<Theme>(CHAVE_TEMA, ['light', 'dark'])
  if (guardado) return guardado
  const claroNoSistema = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches
  return claroNoSistema ? 'light' : 'dark'
}

export function aplicarTokens(raiz: HTMLElement, theme: Theme, density: Density): void {
  const paleta = PALETAS[theme]
  for (const [token, valor] of Object.entries(paleta)) {
    raiz.style.setProperty(cssVarName(token as keyof typeof paleta), valor)
  }
  for (const [nome, valor] of Object.entries(DENSIDADES[density])) {
    raiz.style.setProperty(`--${nome}`, valor)
  }
  raiz.dataset.theme = theme
  raiz.dataset.density = density
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, definirTema] = useState<Theme>(temaInicial)
  const [density, definirDensidade] = useState<Density>(
    () => lerGuardado<Density>(CHAVE_DENSIDADE, ['compact', 'comfortable']) ?? 'comfortable',
  )

  useEffect(() => {
    aplicarTokens(document.documentElement, theme, density)
  }, [theme, density])

  const setTheme = useCallback((t: Theme) => {
    definirTema(t)
    guardar(CHAVE_TEMA, t)
  }, [])

  const setDensity = useCallback((d: Density) => {
    definirDensidade(d)
    guardar(CHAVE_DENSIDADE, d)
  }, [])

  const valor = useMemo(
    () => ({ theme, density, setTheme, setDensity }),
    [theme, density, setTheme, setDensity],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

function usarPreferencias(): Preferencias {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useTheme e useDensity exigem <ThemeProvider>.')
  return ctx
}

export function useTheme(): Pick<Preferencias, 'theme' | 'setTheme'> {
  const { theme, setTheme } = usarPreferencias()
  return { theme, setTheme }
}

export function useDensity(): Pick<Preferencias, 'density' | 'setDensity'> {
  const { density, setDensity } = usarPreferencias()
  return { density, setDensity }
}
