/**
 * Razao de contraste da WCAG 2.2, calculada a partir do hexadecimal.
 *
 * Existe como helper de teste e nao como dependencia: a formula e curta,
 * estavel desde 2008, e depender de um pacote para ela significaria confiar em
 * terceiros justamente na verificacao que existe para nao confiar no olho.
 */
function canalLinear(valor: number): number {
  const v = valor / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminancia(hex: string): number {
  const limpo = hex.replace('#', '')
  const cheio = limpo.length === 3 ? [...limpo].map(c => c + c).join('') : limpo
  const [r, g, b] = [0, 2, 4].map(i => parseInt(cheio.slice(i, i + 2), 16))
  return 0.2126 * canalLinear(r!) + 0.7152 * canalLinear(g!) + 0.0722 * canalLinear(b!)
}

export function contrast(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la]
  return (claro! + 0.05) / (escuro! + 0.05)
}
