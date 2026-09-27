import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * O estado de presenca de alguem.
 *
 * Nunca so pela cor. O ponto CHEIO contra o ponto VAZADO e o que faz a
 * diferenca sobreviver a uma captura em escala de cinza e a quem nao distingue
 * verde de cinza (SC 1.4.1), e o `data-presenca` e o contrato que o teste
 * verifica — ele existe para que "a forma distingue" nao possa ser desfeito
 * por engano num ajuste de estilo.
 *
 * Dois modos, mesma verdade:
 *
 * - `texto` escreve a palavra ao lado do ponto. Serve onde a linha tem espaco
 *   sobrando e o estado e a informacao principal.
 * - `cracha` encolhe o ponto e o encaixa no canto de um avatar, com a palavra
 *   indo para o leitor de tela. E o formato de uma lista densa: com trinta
 *   membros, trinta vezes a palavra "offline" empilhada vira ruido que esconde
 *   justamente as tres pessoas online. A informacao nao some — muda de canal,
 *   e o agrupamento por secao ("Offline — 8") passa a carrega-la em texto.
 */
export function Presenca({ status, modo = 'texto' }: {
  status: 'online' | 'offline'
  modo?: 'texto' | 'cracha'
}): ReactNode {
  const online = status === 'online'

  const ponto = (
    <span
      aria-hidden="true"
      data-presenca={online ? 'cheio' : 'vazado'}
      className={cn(
        'rounded-full border',
        online
          ? 'border-presence-online bg-presence-online'
          : 'border-fg-muted bg-transparent',
        modo === 'cracha'
          // O anel na cor do fundo recorta o ponto para fora do avatar, em vez
          // de pousar em cima dele: sem isso, um avatar escuro engole o circulo
          // vazado do offline.
          ? 'size-2.5 border-2 ring-2 ring-bg-raised'
          : 'size-2',
      )}
    />
  )

  if (modo === 'cracha') {
    return (
      <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex">
        {ponto}
        <span className="sr-only">{status}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {ponto}
      <span className="text-xs text-fg-muted">{status}</span>
    </span>
  )
}
