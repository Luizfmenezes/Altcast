import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './ui/ThemeProvider.js'
import { ProvedorDeDicas } from './ui/Tooltip.js'
import { App } from './App.js'
import './ui/tokens.css'

const raiz = document.getElementById('root')
if (!raiz) throw new Error('elemento #root ausente no index.html')

createRoot(raiz).render(
  <StrictMode>
    <ThemeProvider>
      <ProvedorDeDicas>
        <App />
      </ProvedorDeDicas>
    </ThemeProvider>
  </StrictMode>,
)
