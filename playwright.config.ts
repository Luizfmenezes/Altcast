import { defineConfig, devices } from '@playwright/test'

/**
 * Os fluxos rodam contra o STACK DE PRODUCAO, subido pelo compose - nao contra
 * o servidor de desenvolvimento. E a unica forma de o teste cobrir o caminho
 * real: Caddy na frente, proxy do WebSocket, cookie first-party e as imagens
 * que de fato vao para o host.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Os fluxos compartilham um unico banco: rodar em paralelo faria um teste
  // ver o grupo criado por outro.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
