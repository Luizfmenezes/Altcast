import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import './mercurio.css'

/** Seis massas. Menos parece acidente; mais vira sopa. */
const QUANTAS = 6

type Massa = {
  tamanho: number
  esquerda: number
  topo: number
  atraso: number
  duracao: number
}

/**
 * Sorteadas uma vez por montagem, e nao a cada render.
 *
 * Sem o `useMemo` cada re-render — trocar de aba do formulario, digitar uma
 * letra — reposicionaria as massas e a animacao pularia do zero.
 */
function sortear(): Massa[] {
  return Array.from({ length: QUANTAS }, () => ({
    tamanho: Math.random() * 180 + 160,
    esquerda: Math.random() * 78 + 8,
    topo: Math.random() * 78 + 8,
    // Atraso negativo faz cada massa comecar num ponto diferente do ciclo, em
    // vez de todas nascerem juntas e pulsarem em coro.
    atraso: Math.random() * -20,
    duracao: Math.random() * 14 + 16,
  }))
}

export function PalcoMercurio(): ReactNode {
  const massas = useMemo(sortear, [])
  const nos = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    // A folha de tokens ja congela a `animation` sob prefers-reduced-motion,
    // mas o parallax e JavaScript e escapa dela. Quem pediu menos movimento
    // nao pediu menos de um tipo so.
    const quieto = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (quieto) return

    const aoMover = (evento: MouseEvent): void => {
      const x = evento.clientX / window.innerWidth
      const y = evento.clientY / window.innerHeight

      nos.current.forEach((no, i) => {
        if (!no) return
        // Cada massa responde com uma forca diferente: e o que separa as
        // camadas e produz profundidade, em vez de mover o fundo em bloco.
        const forca = (i + 1) * 16
        // `translate3d` na camada de fora: a animacao usa a `transform` da
        // camada de dentro, e as duas convivem sem que nenhuma toque o layout.
        no.style.transform =
          `translate3d(${String(x * forca)}px, ${String(y * forca)}px, 0)`
      })
    }

    document.addEventListener('mousemove', aoMover, { passive: true })
    return () => document.removeEventListener('mousemove', aoMover)
  }, [])

  return (
    <>
      {/* O filtro que funde as massas. `aria-hidden` porque um SVG de zero
          pixel nao e conteudo — e uma definicao. */}
      <svg className="filtro-oculto" aria-hidden="true" focusable="false">
        <defs>
          <filter id="gosma">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="borrado" />
            {/* A matriz estica o canal alfa e corta o meio-tom: bordas
                proximas grudam, distantes ficam separadas. E o truque
                inteiro. */}
            <feColorMatrix
              in="borrado"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="gosma"
            />
            <feComposite in="SourceGraphic" in2="gosma" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div className="palco-mercurio" aria-hidden="true">
        {massas.map((massa, i) => (
          <div
            key={i}
            ref={no => { nos.current[i] = no }}
            className="massa-camada"
            style={{
              width: `${String(massa.tamanho)}px`,
              height: `${String(massa.tamanho)}px`,
              left: `${String(massa.esquerda)}%`,
              top: `${String(massa.topo)}%`,
            }}
          >
            <div
              className="massa"
              style={{
                animationDelay: `${String(massa.atraso)}s`,
                animationDuration: `${String(massa.duracao)}s`,
              }}
            />
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * O palco inteiro: fundo de metal liquido e, por cima, o painel opaco onde o
 * formulario vive.
 */
export function Porta({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="porta">
      <PalcoMercurio />
      <main className="painel-da-porta">{children}</main>
    </div>
  )
}

/** Cabecalho da porta: a marca em mono espacada e o titulo em peso 800. */
export function TituloDaPorta({ titulo, subtitulo }: {
  titulo: ReactNode
  subtitulo?: string
}): ReactNode {
  return (
    <header style={{ marginBlockEnd: '2rem' }}>
      <span className="marca-da-porta">Altcast</span>
      <h1 className="titulo-da-porta">{titulo}</h1>
      {subtitulo !== undefined && <p className="subtitulo-da-porta">{subtitulo}</p>}
    </header>
  )
}
