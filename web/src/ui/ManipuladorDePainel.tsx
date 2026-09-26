import type { ReactNode } from 'react'
import { PanelResizeHandle } from 'react-resizable-panels'

/**
 * A divisoria que se arrasta entre duas colunas.
 *
 * Arrastar NAO pode ser o unico jeito de operar isto. O criterio 2.5.7 da WCAG
 * 2.2 (Dragging Movements) exige uma alternativa de ponteiro unico para toda
 * operacao de arrasto criada pela aplicacao, e quem usa switch, controle de
 * cabeca ou tremor nas maos simplesmente nao arrasta. Sao tres saidas, e todas
 * precisam existir:
 *
 *   1. teclado — a biblioteca ja da setas, Home e End no `role="separator"`;
 *   2. duplo clique aqui, que devolve a largura padrao;
 *   3. os botoes de recolher no cabecalho, que dispensam a divisoria inteira.
 *
 * O desenho e uma linha de 1px, mas a AREA e bem maior — 9px no ponteiro fino
 * e 24px no grosso. Uma linha de 1px clicavel e um alvo que so acerta quem tem
 * pulso firme, e o criterio 2.5.8 pede 24 por 24 CSS px. Atencao: a regra
 * global de 44px em `tokens.css` casa com `button`, `a` e `[role=button]` — um
 * `role="separator"` NAO e alcancado por ela, e por isso a largura no ponteiro
 * grosso precisa estar escrita aqui.
 *
 * `aria-valuenow` vem de fora porque a biblioteca NAO o emite — ela poe
 * `aria-valuemin` e `aria-valuemax` e para por ai, e um separador focavel sem
 * `aria-valuenow` e uma violacao de `aria-required-attr` que o axe pega. Mais
 * do que a regra: sem ele o leitor de tela anuncia "separador" e nao diz onde
 * a coluna esta, que e a unica informacao que importa enquanto se redimensiona
 * sem enxergar.
 */
export function ManipuladorDePainel({
  rotulo, aoRestaurar, porcentagem,
}: {
  rotulo: string
  /** Onde a coluna esta agora, em porcentagem do grupo. */
  porcentagem: number
  /** Duplo clique devolve a largura padrao. */
  aoRestaurar?: () => void
}): ReactNode {
  return (
    <PanelResizeHandle
      aria-label={rotulo}
      aria-valuenow={Math.round(porcentagem)}
      {...(aoRestaurar === undefined ? {} : { onDoubleClick: aoRestaurar })}
      className="group relative -mx-1 w-[9px] shrink-0 cursor-col-resize
                 outline-none
                 pointer-coarse:-mx-[11px] pointer-coarse:w-[24px]"
    >
      {/*
        A linha visivel, centralizada dentro da area de toque. `aria-hidden`
        porque quem anuncia e o separador de fora — este span e so a tinta.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2
                   bg-border-subtle transition-colors
                   group-hover:bg-accent
                   group-focus-visible:w-0.5 group-focus-visible:bg-focus-ring
                   group-data-[resize-handle-state=drag]:bg-accent
                   group-data-[resize-handle-state=hover]:bg-accent"
      />
    </PanelResizeHandle>
  )
}
