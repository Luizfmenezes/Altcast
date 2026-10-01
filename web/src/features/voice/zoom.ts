import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as MouseDoReact, PointerEvent as PointerDoReact, RefObject } from 'react'

/**
 * Zoom e arrasto dentro de uma transmissao.
 *
 * Quem assiste a uma tela compartilhada de 1440p num quadro de 600px nao le o
 * codigo, a planilha nem o rodape do jogo. Tela cheia ajuda ate o tamanho do
 * monitor — e no celular nem isso. O que resolve e o mesmo gesto de qualquer
 * visualizador de imagem: aproximar onde se quer ler, e arrastar.
 *
 * A conta mora em funcoes puras, testaveis sem DOM; o hook so traduz ponteiro
 * em chamada.
 *
 * O sistema de coordenadas: `transform-origin: 0 0`, e a vista e
 * `translate(x, y) scale(s)`. Com isso o conteudo ocupa [x, x + w*s] na
 * horizontal, e manter a janela coberta e exigir x entre w - w*s e 0.
 */

export type Vista = { s: number; x: number; y: number }

export const VISTA_INICIAL: Vista = { s: 1, x: 0, y: 0 }
export const ZOOM_MINIMO = 1
export const ZOOM_MAXIMO = 6
/** O passo dos botoes e do teclado: 1,5x por clique — 4 cliques vao de 1x a 5x. */
export const PASSO = 1.5
/** O duplo clique vai direto aqui: perto o bastante para ler texto de tela. */
export const ZOOM_DO_DUPLO = 2.5

const entre = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

/** Mantem a escala no intervalo e a janela sempre coberta pelo conteudo. */
export function limitar(v: Vista, w: number, h: number): Vista {
  const s = entre(v.s, ZOOM_MINIMO, ZOOM_MAXIMO)
  return { s, x: entre(v.x, w - w * s, 0), y: entre(v.y, h - h * s, 0) }
}

/**
 * Escala por `fator`, mantendo PARADO o ponto (px, py) da janela.
 *
 * E o que faz o zoom ir para onde o cursor (ou o meio dos dois dedos) esta, e
 * nao para o canto: o ponto sob o dedo antes do gesto continua sob o dedo
 * depois dele.
 */
export function aproximarEm(v: Vista, fator: number, px: number, py: number, w: number, h: number): Vista {
  const s = entre(v.s * fator, ZOOM_MINIMO, ZOOM_MAXIMO)
  const real = s / v.s
  return limitar({ s, x: px - (px - v.x) * real, y: py - (py - v.y) * real }, w, h)
}

export function arrastar(v: Vista, dx: number, dy: number, w: number, h: number): Vista {
  return limitar({ s: v.s, x: v.x + dx, y: v.y + dy }, w, h)
}

/** Duplo clique: aproxima no ponto, ou volta ao inteiro se ja estava perto. */
export function alternarDuplo(v: Vista, px: number, py: number, w: number, h: number): Vista {
  return v.s > 1.01 ? VISTA_INICIAL : aproximarEm(v, ZOOM_DO_DUPLO / v.s, px, py, w, h)
}

type Ponto = { x: number; y: number }

/**
 * Liga zoom e arrasto a uma janela.
 *
 * - roda com Ctrl (e a pinca do trackpad, que chega como roda com Ctrl):
 *   aproxima no cursor. Sem Ctrl, so quando ja ha zoom — antes disso a roda
 *   pertence a rolagem do painel, e roubar ela prenderia a pessoa no video;
 * - um ponteiro arrastando, com zoom: move a vista;
 * - dois dedos: pinca no ponto medio;
 * - duplo clique ou duplo toque: 2,5x ali, ou de volta ao inteiro.
 *
 * `chave` zera a vista: outra faixa no mesmo quadro nao herda o zoom da
 * anterior.
 */
export function useZoom(janela: RefObject<HTMLElement | null>, chave: unknown, ativo = true): {
  vista: Vista
  aproximado: boolean
  maisPerto: () => void
  maisLonge: () => void
  restaurar: () => void
  eventos: {
    onPointerDown: (e: PointerDoReact<HTMLElement>) => void
    onPointerMove: (e: PointerDoReact<HTMLElement>) => void
    onPointerUp: (e: PointerDoReact<HTMLElement>) => void
    onPointerCancel: (e: PointerDoReact<HTMLElement>) => void
    onDoubleClick: (e: MouseDoReact<HTMLElement>) => void
  }
} {
  const [vista, setVista] = useState<Vista>(VISTA_INICIAL)
  const ponteiros = useRef(new Map<number, Ponto>())
  const pinca = useRef<{ distancia: number } | null>(null)

  useEffect(() => { setVista(VISTA_INICIAL) }, [chave, ativo])

  const medida = useCallback((): { w: number; h: number; left: number; top: number } => {
    const r = janela.current?.getBoundingClientRect()
    return { w: r?.width ?? 0, h: r?.height ?? 0, left: r?.left ?? 0, top: r?.top ?? 0 }
  }, [janela])

  const noCentro = useCallback((fator: number): void => {
    const { w, h } = medida()
    setVista(v => aproximarEm(v, fator, w / 2, h / 2, w, h))
  }, [medida])

  /**
   * A roda vai por ouvinte NATIVO, e nao por `onWheel`: o React registra roda
   * como passiva, e ali o `preventDefault` nao impede nada — a pagina rolaria
   * (ou o navegador inteiro aproximaria) junto com o video.
   */
  const escala = useRef(vista.s)
  escala.current = vista.s
  useEffect(() => {
    const alvo = janela.current
    if (alvo === null || !ativo) return
    const aoRolar = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey && escala.current <= 1) return
      e.preventDefault()
      const { w, h, left, top } = medida()
      // Exponencial no delta: o trackpad manda deltas pequenos e muitos, a
      // roda manda poucos e grandes, e os dois precisam parecer o mesmo gesto.
      const fator = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      setVista(v => aproximarEm(v, fator, e.clientX - left, e.clientY - top, w, h))
    }
    alvo.addEventListener('wheel', aoRolar, { passive: false })
    return () => { alvo.removeEventListener('wheel', aoRolar) }
  }, [janela, medida, ativo])

  const onPointerDown = useCallback((e: PointerDoReact<HTMLElement>): void => {
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()] as [Ponto, Ponto]
      pinca.current = { distancia: Math.hypot(a.x - b.x, a.y - b.y) }
    }
    // Capturar so quando ha o que arrastar: sem zoom, o toque precisa seguir
    // livre para rolar o painel e chegar aos botoes por cima do video.
    if (vista.s > 1 || ponteiros.current.size === 2) e.currentTarget.setPointerCapture(e.pointerId)
  }, [vista.s])

  const onPointerMove = useCallback((e: PointerDoReact<HTMLElement>): void => {
    const antes = ponteiros.current.get(e.pointerId)
    if (antes === undefined) return
    const agora = { x: e.clientX, y: e.clientY }
    ponteiros.current.set(e.pointerId, agora)
    const { w, h, left, top } = medida()

    if (ponteiros.current.size >= 2 && pinca.current !== null) {
      const [a, b] = [...ponteiros.current.values()] as [Ponto, Ponto]
      const distancia = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinca.current.distancia > 0) {
        const fator = distancia / pinca.current.distancia
        setVista(v => aproximarEm(v, fator, (a.x + b.x) / 2 - left, (a.y + b.y) / 2 - top, w, h))
      }
      pinca.current = { distancia }
      return
    }
    if (vista.s <= 1) return
    setVista(v => arrastar(v, agora.x - antes.x, agora.y - antes.y, w, h))
  }, [medida, vista.s])

  const soltar = useCallback((e: PointerDoReact<HTMLElement>): void => {
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size < 2) pinca.current = null
  }, [])

  const onDoubleClick = useCallback((e: MouseDoReact<HTMLElement>): void => {
    const { w, h, left, top } = medida()
    setVista(v => alternarDuplo(v, e.clientX - left, e.clientY - top, w, h))
  }, [medida])

  return {
    vista,
    aproximado: vista.s > 1.01,
    maisPerto: () => { noCentro(PASSO) },
    maisLonge: () => { noCentro(1 / PASSO) },
    restaurar: () => { setVista(VISTA_INICIAL) },
    eventos: {
      onPointerDown, onPointerMove,
      onPointerUp: soltar, onPointerCancel: soltar, onDoubleClick,
    },
  }
}
