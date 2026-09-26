import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Color, Mesh, Program, Renderer, Triangle } from 'ogl'
import { FRAG, VERT } from './aurora.shaders.js'
import { usaAbaVisivel, usaMovimentoReduzido } from './movimento.js'

/**
 * A aurora de fundo. WebGL, via `ogl`.
 *
 * Adaptada do `Aurora` do React Bits (MIT + Commons Clause — ver NOTICES.md).
 * As mudancas sao todas sobre CUSTO, porque um contexto WebGL permanente e a
 * unica coisa nesta base de codigo que disputa GPU com o encode e o decode de
 * video de uma chamada:
 *
 * 1. **Nunca na superficie de chamada.** Este componente so aparece na porta de
 *    entrada, nas boas-vindas e em estado vazio — telas onde nao ha video
 *    nenhum concorrendo. Quem o importar para dentro de um canal esta fazendo a
 *    coisa errada.
 * 2. **Some quando a aba some.** O navegador estrangula o `rAF` de aba oculta,
 *    mas nao o de janela apenas coberta — que e o caso normal de quem joga com
 *    o Altcast atras.
 * 3. **Nao existe sob `prefers-reduced-motion`.** Nao "anima devagar": nao
 *    monta. Um shader parado ainda segura um contexto de GPU.
 * 4. **Carregada por `lazy`** de quem a usa, para que `ogl` nunca entre no
 *    pacote inicial.
 * 5. **Cores do tema**, lidas das variaveis que o ThemeProvider escreve.
 *
 * `aria-hidden` e definitivo: isto e papel de parede, e papel de parede nao
 * tem o que dizer a ninguem.
 */
export function Aurora({ amplitude = 0.9, blend = 0.55 }: {
  amplitude?: number
  blend?: number
}): ReactNode {
  const caixa = useRef<HTMLDivElement>(null)
  const reduzido = usaMovimentoReduzido()
  const visivel = usaAbaVisivel()
  const ativa = !reduzido && visivel

  useEffect(() => {
    const ctn = caixa.current
    if (ctn === null || !ativa) return

    /**
     * WebGL nao e garantido, e a falha nao e teorica.
     *
     * O jsdom nao tem nenhum; um navegador com aceleracao desligada, um driver
     * na lista de bloqueio do Chrome ou uma maquina virtual sem GPU tambem
     * nao. Sem esta guarda, `new Renderer` lanca de dentro de um efeito e
     * derruba a arvore inteira — a tela de boas-vindas viraria uma pagina em
     * branco por causa de um papel de parede.
     *
     * `try` em volta e nao so a checagem: criar o contexto pode falhar DEPOIS
     * de `getContext` responder, quando o processo de GPU cai.
     */
    let renderer: Renderer
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true })
      if (!renderer.gl) return
    } catch {
      return
    }
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.canvas.style.backgroundColor = 'transparent'

    const lido = (nome: string, reserva: string): string =>
      getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || reserva

    // O acento nas pontas e um roxo no meio: a paleta do app so tem UM acento
    // de acao, e uma aurora monocromatica seria um borrao. O roxo vem da
    // familia dos avatares, que ja passou pelo teste de contraste.
    const paradas = [
      lido('--color-accent', '#60a5fa'),
      '#793ecc',
      lido('--color-accent', '#60a5fa'),
    ].map(hex => {
      const c = new Color(hex)
      return [c.r, c.g, c.b]
    })

    const geometry = new Triangle(gl)
    if (geometry.attributes.uv) delete geometry.attributes.uv

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: paradas },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: blend },
        // O modo claro do shader pinta sobre branco; o tema do app decide.
        uLightMode: {
          value: document.documentElement.dataset['theme'] === 'light' ? 1 : 0,
        },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    ctn.appendChild(gl.canvas)

    const medir = (): void => {
      renderer.setSize(ctn.offsetWidth, ctn.offsetHeight)
      program.uniforms['uResolution'].value = [ctn.offsetWidth, ctn.offsetHeight]
    }
    const ro = new ResizeObserver(medir)
    ro.observe(ctn)
    medir()

    let quadro = 0
    const passo = (t: number): void => {
      quadro = requestAnimationFrame(passo)
      program.uniforms['uTime'].value = t * 0.001 * 0.12
      renderer.render({ scene: mesh })
    }
    quadro = requestAnimationFrame(passo)

    return () => {
      cancelAnimationFrame(quadro)
      ro.disconnect()
      if (gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas)
      // Sem isto, cada montagem deixa um contexto WebGL orfao para tras, e o
      // navegador derruba o mais antigo depois de dezesseis — o sintoma e uma
      // tela que "para de animar" sem erro nenhum no console.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [ativa, amplitude, blend])

  if (!ativa) return null

  return (
    <div
      ref={caixa}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 opacity-60 [&>canvas]:size-full"
    />
  )
}

export default Aurora
