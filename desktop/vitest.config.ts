import { defineConfig } from 'vitest/config'

/**
 * O `desktop/` nao tinha teste nenhum, e a maior parte dele de fato nao da
 * para testar sem um processo grafico. Mas a geometria da janela da — e e
 * justamente ela que, errada, produz uma janela invisivel com o microfone
 * aberto.
 *
 * Ambiente `node`: nada aqui toca DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
})
