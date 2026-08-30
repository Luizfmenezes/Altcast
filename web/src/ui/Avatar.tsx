import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'

const TAMANHOS = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-[12px]',
  lg: 'size-10 text-[14px]',
  xl: 'size-16 text-[22px]',
} as const

/**
 * Dez fundos fixos para avatar sem imagem, escolhidos por hash do nome.
 *
 * Fixos e nao aleatorios porque a cor precisa ser a mesma em toda sessao e em
 * todo dispositivo: um avatar que troca de cor a cada carga deixa de ser um
 * jeito de reconhecer alguem.
 *
 * Valores literais, e nao `hsl(matiz 58% 34%)` calculado: claridade em HSL nao
 * e luminancia percebida, e a mesma claridade que da 7.7:1 no azul da 4.1:1 no
 * verde. Cada tom teve a claridade resolvida individualmente contra o branco.
 *
 * Duas faixas ficaram de fora de proposito. Vermelho, porque nesta paleta ele
 * significa erro e destruicao, e um avatar vermelho diria isso de uma pessoa.
 * E a faixa do azul do acento, para que um avatar nunca seja lido como o item
 * selecionado.
 *
 * O teste de contraste em test/avatar.test.ts e quem garante as duas coisas.
 */
export const CORES_DE_AVATAR = [
  '#297d9b',
  '#228174',
  '#238551',
  '#498323',
  '#8b7125',
  '#a5652c',
  '#cc3e6d',
  '#ca389e',
  '#b83ccb',
  '#793ecc',
] as const

export function corDe(semente: string): string {
  let acumulado = 0
  for (let i = 0; i < semente.length; i++) acumulado = (acumulado * 31 + semente.charCodeAt(i)) >>> 0
  return CORES_DE_AVATAR[acumulado % CORES_DE_AVATAR.length] ?? CORES_DE_AVATAR[0]
}

/** A inicial de 'Ana Paula' e 'A', nao 'AP': duas letras num circulo de 24px viram borrao. */
function inicialDe(nome: string): string {
  return [...nome.trim()][0]?.toUpperCase() ?? '?'
}

export function Avatar({
  nome, url, tamanho = 'md', quadrado = false, className,
}: {
  nome: string
  url?: string | null
  tamanho?: keyof typeof TAMANHOS
  /** O rail de grupos usa quadrado arredondado; pessoas sao sempre circulo. */
  quadrado?: boolean
  className?: string
}): ReactNode {
  const base = cn(
    'flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold',
    quadrado ? 'rounded-[10px]' : 'rounded-full',
    TAMANHOS[tamanho], className,
  )

  // aria-hidden e alt vazio de proposito: o nome ja e escrito ao lado ou num
  // sr-only pelo componente que chama. Repeti-lo aqui faria o leitor de tela
  // anunciar a mesma pessoa duas vezes seguidas.
  if (url) {
    return <img src={url} alt="" aria-hidden="true" className={cn(base, 'object-cover')} />
  }

  return (
    <span aria-hidden="true" className={cn(base, 'text-white')} style={{ background: corDe(nome) }}>
      {inicialDe(nome)}
    </span>
  )
}
