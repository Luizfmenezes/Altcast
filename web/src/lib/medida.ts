import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * A largura atual de um elemento, em pixels.
 *
 * `useLayoutEffect` e nao `useEffect`: a primeira medida precisa acontecer
 * ANTES de o navegador pintar, senao as colunas nascem no tamanho de
 * referencia e saltam para o tamanho certo no quadro seguinte — um pulo
 * visivel toda vez que a aplicacao abre.
 *
 * Devolve `0` enquanto nao ha medida (jsdom, primeiro quadro). Quem consome
 * trata o zero caindo numa largura de referencia, e e isso que mantem os
 * testes de unidade rodando sem um motor de layout por tras.
 */
export function usaLarguraDe(ref: RefObject<HTMLElement | null>): number {
  const [largura, setLargura] = useState(0)

  useLayoutEffect(() => {
    const alvo = ref.current
    if (alvo === null) return

    setLargura(alvo.getBoundingClientRect().width)

    // Pode nao existir: o jsdom nao tem, e o duble do setup de teste nunca
    // notifica nada. A medida sincrona acima ja cobriu o caso inicial.
    if (typeof ResizeObserver === 'undefined') return

    const observador = new ResizeObserver(entradas => {
      const nova = entradas[0]?.contentRect.width
      if (nova !== undefined) setLargura(nova)
    })
    observador.observe(alvo)
    return () => { observador.disconnect() }
  }, [ref])

  return largura
}
