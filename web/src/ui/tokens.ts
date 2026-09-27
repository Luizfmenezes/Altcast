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
 * neutro frio como estrutura, AMBAR como unico acento de acao, verde apenas
 * para presenca, vermelho apenas para erro e destruicao. Quando o vermelho
 * aparece, ele significa alguma coisa.
 *
 * O ambar e a luz de "no ar" de um estudio (Design System v2, decisao D1-B do
 * super plano). O acento era o azul padrao do Tailwind, e com ele o app era
 * intercambiavel com qualquer clone; o ambar liga o nome do produto — cast,
 * transmissao — a forma. O tom mais vivo dele (`accentLive`) e reservado ao
 * que esta no ar AGORA: quem fala, o que transmite.
 *
 * Os neutros continuam slate, levemente frios: o contraste de temperatura com
 * um acento quente e o que faz o ambar ler como sinal, e nao como decoracao.
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
  /**
   * Fundo discreto do acento: a mencao a mim, o canal com mencao, o item
   * escolhido de uma lista. Nunca carrega texto em `accent` por cima — so
   * `fg`, que e o que garante leitura nos dois temas.
   */
  accentSubtle: string
  /** Fundo afundado: o campo de escrita e os campos de formulario. */
  bgSunken: string
  /** Anel de foco, 2px com deslocamento (SC 2.4.11). */
  focusRing: string
  /** Exclusivo de erro e destruicao. */
  danger: string
  /** Texto sobre o vermelho solido. */
  dangerFg: string
  /** Exclusivo de presenca online — sempre acompanhado de forma e rotulo. */
  presenceOnline: string
  /**
   * So o "no ar": quem esta falando, o que esta transmitindo agora. Separado
   * do acento de acao porque um botao primario e um microfone aberto nao
   * podem ser a mesma coisa para o olho.
   */
  accentLive: string
  /** Aviso — sempre com icone e texto, nunca a cor sozinha. */
  warning: string
}

/**
 * O ambar do tema claro e bem mais escuro que o do escuro, e nao por gosto: ele
 * precisa alcancar 4.5:1 duas vezes — com texto branco por cima, quando e fundo
 * de botao, e sobre `bgHover`, quando e o nome do canal ativo. O `#b45309` do
 * desenho original passa no primeiro caso e da 4.07:1 no segundo, reprovando.
 * A conformidade decide o tom, e nao o inverso.
 */
export const LIGHT: Palette = {
  bg: '#ffffff',
  bgRaised: '#f1f5f9',
  bgHover: '#e2e8f0',
  fg: '#0f172a',
  fgMuted: '#475569',
  border: '#64748b',
  borderSubtle: '#cbd5e1',
  accent: '#a14a06',
  accentFg: '#ffffff',
  accentSubtle: '#fef3c7',
  bgSunken: '#f8fafc',
  focusRing: '#a14a06',
  danger: '#b91c1c',
  dangerFg: '#ffffff',
  presenceOnline: '#047857',
  accentLive: '#c2610a',
  warning: '#9a5c06',
}

/** Escuro e o padrao: e o habito da categoria e reduz fadiga em uso prolongado. */
export const DARK: Palette = {
  bg: '#06070a',
  bgRaised: '#101319',
  bgHover: '#1e2530',
  fg: '#f8fafc',
  fgMuted: '#94a3b8',
  border: '#64748b',
  borderSubtle: '#2a313d',
  accent: '#f59e0b',
  accentFg: '#1a1204',
  accentSubtle: '#f59e0b1f',
  bgSunken: '#040507',
  focusRing: '#f59e0b',
  danger: '#f87171',
  dangerFg: '#0f172a',
  presenceOnline: '#34d399',
  accentLive: '#fbbf24',
  warning: '#eab308',
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
