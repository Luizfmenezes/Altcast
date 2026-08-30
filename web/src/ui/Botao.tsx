import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils.js'

/**
 * O `variante` continua em portugues e com os mesmos tres valores de sempre:
 * dezessete chamadas dependem deles, e renomear um vocabulario que ja funciona
 * so para parecer com uma biblioteca seria trocar trabalho por nada.
 */
export const estilosDeBotao = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md
   font-medium transition-[background-color,color,border-color,box-shadow,opacity]
   duration-150 ease-out
   disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50
   [&_svg]:pointer-events-none [&_svg]:shrink-0`,
  {
    variants: {
      variante: {
        // A sombra tem deslocamento e desfoque: um halo sem deslocamento nao e
        // profundidade, e decoracao que finge ser profundidade.
        primario: `bg-accent text-accent-fg shadow-[0_1px_2px_0_rgb(0_0_0/0.18)]
                   hover:brightness-110 active:brightness-95`,
        discreto: `border border-border-subtle bg-bg-raised text-fg
                   hover:border-border hover:bg-bg-hover active:brightness-95`,
        perigo: `bg-danger text-danger-fg shadow-[0_1px_2px_0_rgb(0_0_0/0.18)]
                 hover:brightness-110 active:brightness-95`,
        fantasma: 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        vinculo: 'text-accent underline-offset-4 hover:underline',
      },
      tamanho: {
        // 36px cobre com folga o alvo de 24x24 da SC 2.5.8; a folha de tokens
        // amplia para 44px onde a entrada e por toque.
        md: 'h-9 min-w-9 px-3 text-sm [&_svg]:size-4',
        sm: 'h-8 min-w-8 px-2.5 text-[13px] [&_svg]:size-3.5',
        lg: 'h-11 min-w-11 px-5 text-[15px] [&_svg]:size-[18px]',
        icone: 'size-9 p-0 [&_svg]:size-[18px]',
        iconeSm: 'size-8 p-0 [&_svg]:size-4',
      },
      largura: {
        automatica: '',
        cheia: 'w-full',
      },
    },
    defaultVariants: { variante: 'primario', tamanho: 'md', largura: 'automatica' },
  },
)

export type PropsDoBotao =
  & ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof estilosDeBotao>
  & {
    /**
     * Renderiza no filho em vez de num <button>. E o que permite um link que
     * parece botao continuar sendo <a> — trocar a tag pela aparencia tiraria
     * dele o Enter, o menu de contexto e o "abrir em nova aba".
     */
    asChild?: boolean
  }

export function Botao({
  variante, tamanho, largura, asChild = false, className, children, ...resto
}: PropsDoBotao): ReactNode {
  const Componente = asChild ? Slot : 'button'
  return (
    <Componente
      {...resto}
      className={cn(estilosDeBotao({ variante, tamanho, largura }), className)}
    >
      {children}
    </Componente>
  )
}
