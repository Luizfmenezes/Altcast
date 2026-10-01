import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from './ui/ThemeProvider.js'
import { ProvedorDeDicas } from './ui/Tooltip.js'
import { Faisca } from './ui/bits/Faisca.js'
import { App } from './App.js'
import { ligarApp } from './lib/instalacao.js'
import { nativo } from './lib/nativo.js'
import './ui/tokens.css'

// O app instalavel. No desktop (Electron) quem cuida de janela, atualizacao e
// notificacao e o proprio aplicativo — um service worker la so atrapalharia.
ligarApp({ registrar: import.meta.env.PROD && nativo() === null })

const raiz = document.getElementById('root')
if (!raiz) throw new Error('elemento #root ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    {/*
      `reducedMotion="user"` na raiz, e nao componente a componente.

      Ele faz a `motion` consultar `prefers-reduced-motion` por conta propria e
      desligar transformacoes em TODA animacao da arvore — inclusive as que
      alguem acrescentar depois sem lembrar da regra. Uma politica que depende
      de cada autor lembrar dela ja nasceu furada; os componentes que desenham
      em canvas ou WebGL, que a `motion` nao enxerga, perguntam sozinhos em
      `ui/bits/movimento.ts`.
    */}
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <ProvedorDeDicas>
          {/* O canvas das faiscas cobre a aplicacao inteira e nao intercepta
              clique nenhum. Ele desenha por cima; quem clica continua
              clicando no que estava embaixo. */}
          <Faisca>
            <App />
          </Faisca>
        </ProvedorDeDicas>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
)
