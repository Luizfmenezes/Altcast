import { useEffect, useState } from 'react'

/**
 * A pessoa pediu menos movimento?
 *
 * O `MotionConfig reducedMotion="user"` em `main.tsx` ja cobre tudo que e
 * `motion`, porque a biblioteca consulta a mesma media query por dentro. O que
 * ele NAO cobre e o que desenha fora do React: canvas em `requestAnimationFrame`
 * e shader em WebGL continuariam rodando alegremente. Esses precisam perguntar,
 * e esta funcao e onde a pergunta mora — uma vez so, em vez de espalhada.
 *
 * Nenhum dos 209 componentes do React Bits faz isso por conta propria; e a
 * primeira adaptacao que qualquer um deles exige aqui.
 */
export function usaMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(() =>
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      // Sem `matchMedia` — jsdom — a resposta e "nao reduzir": a alternativa
      // faria todo teste exercitar o caminho estatico e nunca o animado.
      : false)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const aoMudar = (): void => setReduzido(mq.matches)
    setReduzido(mq.matches)
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [])

  return reduzido
}

/**
 * A aba esta visivel?
 *
 * Um laco de animacao numa aba em segundo plano e consumo puro. O navegador ja
 * estrangula o `requestAnimationFrame` de abas ocultas, mas nao o de uma janela
 * apenas coberta por outra — e num app que fica aberto o dia inteiro ao lado de
 * um jogo, essa e a situacao normal, nao a excecao.
 */
export function usaAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(() =>
    typeof document === 'undefined' || document.visibilityState === 'visible')

  useEffect(() => {
    const aoMudar = (): void => setVisivel(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', aoMudar)
    return () => document.removeEventListener('visibilitychange', aoMudar)
  }, [])

  return visivel
}
