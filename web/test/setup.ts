import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { useRascunhos } from '../src/features/messages/rascunhos.js'
import { useHistorico } from '../src/features/messages/historico.js'

// A limpeza automatica da testing-library depende de `globals: true`, que a
// suite nao usa. Sem este afterEach o DOM do teste anterior sobrevive e a
// consulta seguinte encontra dois de cada elemento.
afterEach(cleanup)

/**
 * Os rascunhos por canal e o estado do historico vivem em modulos, e nao em
 * componentes — sobrevivem ao desmonte de proposito. Entre testes isso vira
 * vazamento: o texto digitado num teste aparecia no campo do seguinte.
 */
afterEach(() => {
  try { sessionStorage.clear() } catch { /* jsdom sem armazenamento */ }
  useRascunhos.setState({ rascunhos: {}, envios: [] })
  useHistorico.setState({ porCanal: {} })
})

/**
 * `ResizeObserver` nao existe no jsdom, e `react-resizable-panels` o exige —
 * sem este duble, TODA suite que renderiza o AppShell quebra na montagem, e
 * nao so as que testam layout.
 *
 * Os metodos sao vazios de proposito, e isso nao e preguica: o jsdom nao faz
 * layout, entao nada nunca muda de tamanho e nao ha o que notificar. Quem
 * depende de medida real — a largura persistida das colunas — e verificado no
 * Playwright, contra um navegador de verdade.
 */
class ObservadorDeTamanho implements ResizeObserver {
  observe(): void { /* nada muda de tamanho sem layout */ }
  unobserve(): void { /* idem */ }
  disconnect(): void { /* idem */ }
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ObservadorDeTamanho
}
