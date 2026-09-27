import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'

/**
 * Um numero que se ANUNCIA quando muda — sem nunca mentir enquanto muda.
 *
 * Inspirado no `CountUp` do React Bits (MIT + Commons Clause — ver
 * NOTICES.md), com a premissa invertida depois de duas tentativas que vale
 * deixar registradas, porque as duas parecem certas no papel.
 *
 * **Interpolar o valor nao serve aqui.** O `CountUp` guarda um numero, anima
 * de zero ate o alvo e escreve cada quadro. Numa vitrine isso e bonito: o alvo
 * e constante e a animacao roda uma vez. Neste painel o alvo e vivo — a
 * contagem nasce zero e vira um quando o `ready` do socket chega, e muda a
 * cada pessoa que entra ou sai. Qualquer animacao interrompida por um
 * re-render deixa o cabecalho exibindo um numero que contradiz a lista logo
 * abaixo. Foi o que aconteceu, medido: a secao dizia "Dono — 1" e o cabecalho
 * insistia em "0 online".
 *
 * **`AnimatePresence` com `exit` tambem nao.** A saida mantem o no antigo vivo
 * ate a animacao terminar; quando ela nao termina — e aqui nao terminava — o
 * valor velho fica preso na tela (`mode="wait"`) ou empilhado com o novo
 * (`mode="popLayout"`, que rendia um literal "01"). Um efeito cuja falha
 * exibe o dado errado nao e um efeito aceitavel num painel de presenca.
 *
 * **O que sobra e correto por construcao:** a `key` no proprio valor faz o
 * React trocar o no inteiro, e o novo entra animando. Nao ha saida, entao nao
 * ha nada que possa ficar pendurado; o DOM tem sempre exatamente um numero, e
 * ele e sempre o verdadeiro. A animacao ficou menor do que a do React Bits, e
 * em troca ela nao tem como mentir.
 *
 * `MotionConfig reducedMotion="user"`, na raiz, remove o deslocamento para
 * quem pediu menos movimento — o numero continua certo.
 *
 * Sem `aria-live` de proposito: quem ouve ja recebe a contagem pelo rotulo da
 * secao, e anunciar cada troca transformaria uma sala movimentada numa
 * metralhadora.
 */
const FORMATO = new Intl.NumberFormat('pt-BR')

export function Contador({ para, className }: {
  para: number
  className?: string
}): ReactNode {
  /**
   * So anima quando o numero MUDA depois de montado (Design System v2: no modo
   * de trabalho, movimento informa estado). Na montagem — trocar de grupo,
   * abrir o painel — o numero nao mudou de nada; ele so apareceu, e anima-lo
   * ali era enfeite repetido a cada clique.
   */
  const inicial = useRef(para)
  const mudou = para !== inicial.current
  return (
    <motion.span
      key={para}
      initial={mudou ? { y: '0.35em', opacity: 0.35 } : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`inline-block tabular-nums ${className ?? ''}`}
    >
      {FORMATO.format(para)}
    </motion.span>
  )
}
