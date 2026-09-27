/**
 * "Chrome no Windows", a partir do user-agent cru.
 *
 * A lista de sessoes mostrava a string inteira —
 * `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...` —, que e
 * a pergunta "qual destes aparelhos e o meu?" respondida numa lingua que
 * ninguem le. A string completa continua disponivel num `<details>`, para quem
 * precisa dela num chamado de suporte.
 *
 * Nao e deteccao de navegador para decidir comportamento — isso seria fragil
 * e errado. E so um rotulo, e um rotulo que erra diz "Navegador".
 */

type Regra = [RegExp, string]

/**
 * A ordem importa: o Edge e o Opera se anunciam TAMBEM como Chrome, e o
 * Chrome se anuncia tambem como Safari. O mais especifico vem primeiro.
 */
const NAVEGADORES: Regra[] = [
  [/Electron\//, 'Altcast para desktop'],
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SISTEMAS: Regra[] = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
]

const primeiro = (regras: Regra[], ua: string): string | null =>
  regras.find(([padrao]) => padrao.test(ua))?.[1] ?? null

export function descreverAparelho(ua: string | null): string {
  if (ua === null || ua.trim() === '') return 'Aparelho desconhecido'
  const navegador = primeiro(NAVEGADORES, ua)
  const sistema = primeiro(SISTEMAS, ua)
  if (navegador !== null && sistema !== null) return `${navegador} no ${sistema}`
  return navegador ?? sistema ?? 'Navegador'
}

const RELATIVO = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

/**
 * "agora", "há 5 minutos", "ontem". Acima de uma semana, a data: "há 47 dias"
 * obriga a fazer conta, e ninguem lembra o que fez 47 dias atras.
 */
export function haQuanto(iso: string, agora: number = Date.now()): string {
  const segundos = Math.round((new Date(iso).getTime() - agora) / 1000)
  const abs = Math.abs(segundos)
  if (abs < 60) return 'agora'
  if (abs < 3600) return RELATIVO.format(Math.round(segundos / 60), 'minute')
  if (abs < 86_400) return RELATIVO.format(Math.round(segundos / 3600), 'hour')
  if (abs < 7 * 86_400) return RELATIVO.format(Math.round(segundos / 86_400), 'day')
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(iso))
}
