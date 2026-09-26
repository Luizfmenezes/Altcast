import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { usaMovimentoReduzido } from './movimento.js'

/**
 * A faisca do clique.
 *
 * Adaptado do `ClickSpark` do React Bits (MIT + Commons Clause — ver
 * NOTICES.md). Tres mudancas, e as tres importam num app que fica aberto o dia
 * inteiro:
 *
 * 1. **O laco so existe enquanto ha faisca.** O original mantem um
 *    `requestAnimationFrame` eterno limpando um canvas vazio sessenta vezes por
 *    segundo, para sempre. Aqui o laco nasce no clique e morre quando a ultima
 *    faisca se apaga.
 * 2. **Respeita `prefers-reduced-motion`.** O original nao pergunta.
 * 3. **A cor vem do tema.** O original chega com `#fff` cravado, que some no
 *    tema claro.
 *
 * O canvas e `pointer-events: none` e o container nao intercepta nada: o clique
 * continua chegando em quem estava embaixo. Isto aqui e decoracao pura, e
 * decoracao que engole um clique deixa de ser decoracao.
 */

type Faiscar = { x: number; y: number; angulo: number; nascidaEm: number }

const QUANTIDADE = 8
const DURACAO_MS = 420
const RAIO = 16
const TAMANHO = 10

export function Faisca({ children }: { children: ReactNode }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null)
  const faiscas = useRef<Faiscar[]>([])
  const quadro = useRef<number | null>(null)
  const reduzido = usaMovimentoReduzido()

  const medir = useCallback(() => {
    const tela = canvas.current
    const pai = tela?.parentElement
    if (!tela || !pai) return
    const { width, height } = pai.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    tela.width = Math.round(width * dpr)
    tela.height = Math.round(height * dpr)
    tela.style.width = `${width}px`
    tela.style.height = `${height}px`
    tela.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  useEffect(() => {
    const pai = canvas.current?.parentElement
    if (!pai) return
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(pai)
    return () => ro.disconnect()
  }, [medir])

  // Um laco pendurado num desmonte e o jeito mais discreto de vazar memoria.
  useEffect(() => () => {
    if (quadro.current !== null) cancelAnimationFrame(quadro.current)
  }, [])

  const desenhar = useCallback(() => {
    const tela = canvas.current
    const ctx = tela?.getContext('2d')
    if (!tela || !ctx) return

    const agora = performance.now()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.clearRect(0, 0, tela.width / dpr, tela.height / dpr)

    // A cor do acento, lida do tema em tempo de desenho: o ThemeProvider a
    // reescreve quando a pessoa troca de tema, e ler aqui nos poupa de
    // reagir a isso.
    const cor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent').trim() || '#60a5fa'

    faiscas.current = faiscas.current.filter(f => {
      const decorrido = agora - f.nascidaEm
      if (decorrido >= DURACAO_MS) return false

      const t = decorrido / DURACAO_MS
      // `ease-out` quadratico: o movimento desacelera como coisa real, sem o
      // repique elastico que o detector de design do projeto reprova.
      const suave = t * (2 - t)
      const distancia = suave * RAIO
      const comprimento = TAMANHO * (1 - suave)

      ctx.strokeStyle = cor
      ctx.globalAlpha = 1 - suave
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(f.x + distancia * Math.cos(f.angulo), f.y + distancia * Math.sin(f.angulo))
      ctx.lineTo(
        f.x + (distancia + comprimento) * Math.cos(f.angulo),
        f.y + (distancia + comprimento) * Math.sin(f.angulo),
      )
      ctx.stroke()
      return true
    })
    ctx.globalAlpha = 1

    // AQUI esta a diferenca para o original: sem faisca viva, o laco acaba.
    if (faiscas.current.length === 0) {
      quadro.current = null
      return
    }
    quadro.current = requestAnimationFrame(desenhar)
  }, [])

  const aoClicar = (evento: MouseEvent<HTMLDivElement>): void => {
    if (reduzido) return
    const tela = canvas.current
    if (!tela) return
    const caixa = tela.getBoundingClientRect()
    const agora = performance.now()
    for (let i = 0; i < QUANTIDADE; i++) {
      faiscas.current.push({
        x: evento.clientX - caixa.left,
        y: evento.clientY - caixa.top,
        angulo: (2 * Math.PI * i) / QUANTIDADE,
        nascidaEm: agora,
      })
    }
    if (quadro.current === null) quadro.current = requestAnimationFrame(desenhar)
  }

  return (
    <div className="relative h-full w-full" onClickCapture={aoClicar}>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-50"
      />
      {children}
    </div>
  )
}
