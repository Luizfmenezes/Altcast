/**
 * Fonte unica das cores da interface.
 *
 * Os valores moram aqui, em TypeScript, e nao no CSS, porque e daqui que o
 * teste de contraste os le. Se a paleta vivesse numa folha de estilo e o teste
 * numa copia, as duas divergiriam no primeiro ajuste e o teste passaria a
 * atestar uma cor que ninguem ve. O ThemeProvider escreve estas variaveis no
 * documento em tempo de execucao: o que e testado e exatamente o que e servido.
 *
 * Paleta multidimensional, jamais dominada por um matiz (spec 05 secao 4):
 * neutro frio como estrutura, ambar como unico acento de acao, verde apenas
 * para presenca, vermelho apenas para erro e destruicao. Quando o vermelho
 * aparece, ele significa alguma coisa.
 */
export type Palette = {
  /** Fundo da aplicacao. */
  bg: string
  /** Fundo de superficie elevada: barras laterais, dialogos, campos. */
  bgRaised: string
  /** Fundo de item sob o cursor ou selecionado. */
  bgHover: string
  /** Texto principal. */
  fg: string
  /** Texto secundario: horarios, metadados, rotulos. */
  fgMuted: string
  /** Borda de componente que precisa ser identificavel (SC 1.4.11). */
  border: string
  /** Divisor decorativo, isento do minimo de 3:1 por nao carregar informacao. */
  borderSubtle: string
  /** Unico acento de acao: botao primario, canal ativo, mencao. */
  accent: string
  /** Texto sobre o acento. */
  accentFg: string
  /** Anel de foco, 2px com deslocamento (SC 2.4.11). */
  focusRing: string
  /** Exclusivo de erro e destruicao. */
  danger: string
  /** Texto sobre o vermelho solido. */
  dangerFg: string
  /** Exclusivo de presenca online — sempre acompanhado de forma e rotulo. */
  presenceOnline: string
}

/**
 * O ambar do tema claro e bem mais escuro que o do escuro, e nao por gosto: ele
 * precisa alcancar 4.5:1 duas vezes - com texto branco por cima, quando e fundo
 * de botao, e sobre `bgHover`, quando e o nome do canal ativo. O tom mais claro
 * passava no primeiro caso e reprovava no segundo. A conformidade decide o tom,
 * e nao o inverso.
 */
export const LIGHT: Palette = {
  bg: '#ffffff',
  bgRaised: '#f4f4f5',
  bgHover: '#e4e4e7',
  fg: '#18181b',
  fgMuted: '#52525b',
  border: '#71717a',
  borderSubtle: '#d4d4d8',
  accent: '#92400e',
  accentFg: '#ffffff',
  focusRing: '#92400e',
  danger: '#b91c1c',
  dangerFg: '#ffffff',
  presenceOnline: '#047857',
}

/** Escuro e o padrao: e o habito da categoria e reduz fadiga em uso prolongado. */
export const DARK: Palette = {
  bg: '#09090b',
  bgRaised: '#18181b',
  bgHover: '#27272a',
  fg: '#fafafa',
  fgMuted: '#a1a1aa',
  border: '#71717a',
  borderSubtle: '#3f3f46',
  accent: '#f59e0b',
  accentFg: '#18120a',
  focusRing: '#f59e0b',
  danger: '#f87171',
  dangerFg: '#18181b',
  presenceOnline: '#34d399',
}

export type Theme = 'light' | 'dark'
export type Density = 'compact' | 'comfortable'

export const PALETAS: Record<Theme, Palette> = { light: LIGHT, dark: DARK }

/**
 * Densidade mexe apenas em espacamento e altura de linha — nunca em tamanho de
 * fonte. Quem usa oito horas por dia quer ver mais linhas; quem entra uma vez
 * por semana quer respiro. Encolher a fonte serviria a um e machucaria os dois.
 */
export const DENSIDADES: Record<Density, Record<string, string>> = {
  compact: {
    'space-row': '0.25rem',
    'space-block': '0.5rem',
    'space-gutter': '0.75rem',
    'leading-body': '1.4',
    'height-row': '1.75rem',
  },
  comfortable: {
    'space-row': '0.5rem',
    'space-block': '0.875rem',
    'space-gutter': '1rem',
    'leading-body': '1.6',
    'height-row': '2.25rem',
  },
}

/** `bg` vira `--color-bg`, que e o nome que o Tailwind e o CSS consomem. */
export function cssVarName(token: keyof Palette): string {
  return `--color-${token.replace(/[A-Z]/g, letra => `-${letra.toLowerCase()}`)}`
}
