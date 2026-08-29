import { execSync } from 'node:child_process'

/** Derruba tudo, inclusive os volumes: nenhum teste herda estado do anterior. */
export default function globalTeardown(): void {
  if (process.env['E2E_MANTER_STACK'] === '1') return
  execSync('docker compose down -v --remove-orphans', {
    env: { ...process.env, POSTGRES_PASSWORD: 'e2e_local', ALLOWED_ORIGINS: 'http://localhost',
      PUBLIC_URL: 'http://localhost', PUBLIC_DOMAIN: 'http://localhost' },
    stdio: 'ignore',
  })
}
