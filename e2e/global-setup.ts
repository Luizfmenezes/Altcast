import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from '@playwright/test'

export const DONO = { email: 'dono@altcast.test', senha: 'frase-longa-de-teste-2026' }
export const ANA = { email: 'ana@altcast.test', senha: 'outra-frase-longa-de-teste' }

export const ESTADO_DONO = 'e2e/.auth/dono.json'
export const ESTADO_ANA = 'e2e/.auth/ana.json'
export const ARQUIVO_GRUPO = 'e2e/.auth/grupo.txt'

const BASE = 'http://localhost'

const AMBIENTE = {
  ...process.env,
  POSTGRES_PASSWORD: 'e2e_local',
  ALLOWED_ORIGINS: BASE,
  PUBLIC_URL: BASE,
  PUBLIC_DOMAIN: BASE,
}

function rodar(comando: string): string {
  return execSync(comando, { env: AMBIENTE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** O grupo do seed, lido do banco: nenhuma rota lista os grupos de fora. */
function grupoDoSeed(): string {
  return rodar(
    'docker compose exec -T postgres psql -U altcast -d altcast -tAc '
    + '"SELECT id FROM groups ORDER BY created_at LIMIT 1"',
  ).trim()
}

/**
 * Sobe o stack, cria as contas e guarda as sessoes em disco.
 *
 * As sessoes sao reaproveitadas pelos testes de proposito: o login e limitado a
 * cinco por minuto por IP, e todos os contextos do Playwright saem do mesmo
 * endereco. Repetir o login em cada teste faria a suite bater no limite e
 * "falhar" por um comportamento que na verdade esta certo - o limitador
 * fazendo exatamente o que a spec 03 pede.
 */
export default async function globalSetup(): Promise<void> {
  // `down -v` antes de subir: o seed aborta se ja existir usuario, entao um
  // banco herdado deixaria a suite inteira sem conta para entrar.
  rodar('docker compose down -v --remove-orphans')
  rodar('docker compose up -d --build')

  for (let tentativa = 1; ; tentativa++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break
    } catch {
      // Ainda subindo.
    }
    if (tentativa > 60) throw new Error('o stack nao respondeu em 120s')
    await new Promise(r => setTimeout(r, 2000))
  }

  // As variaveis precisam entrar NO container: exporta-las no host so alimenta
  // o compose, e o processo do seed roda do outro lado.
  rodar(
    `docker compose exec -T -e SEED_OWNER_EMAIL=${DONO.email} `
    + `-e SEED_OWNER_PASSWORD=${DONO.senha} api node api/dist/cli/seed-owner.js`,
  )

  mkdirSync('e2e/.auth', { recursive: true })
  const grupo = grupoDoSeed()
  writeFileSync(ARQUIVO_GRUPO, grupo, 'utf8')

  const comoDono = await request.newContext({
    baseURL: BASE, extraHTTPHeaders: { origin: BASE },
  })
  const entrada = await comoDono.post('/api/auth/login', {
    data: { email: DONO.email, password: DONO.senha },
  })
  if (!entrada.ok()) throw new Error(`login do dono falhou: ${entrada.status()}`)

  // Ana entra por convite, como qualquer pessoa entraria. O fluxo de convite
  // pela interface continua sendo testado - ali com uma terceira conta.
  const convite = await comoDono.post(`/api/groups/${grupo}/invites`, { data: {} })
  const { code } = await convite.json() as { code: string }

  const comoAna = await request.newContext({
    baseURL: BASE, extraHTTPHeaders: { origin: BASE },
  })
  const cadastro = await comoAna.post('/api/auth/register', {
    data: { email: ANA.email, password: ANA.senha, displayName: 'Ana', inviteCode: code },
  })
  if (!cadastro.ok()) throw new Error(`cadastro da Ana falhou: ${cadastro.status()}`)

  await comoDono.storageState({ path: ESTADO_DONO })
  await comoAna.storageState({ path: ESTADO_ANA })
  await comoDono.dispose()
  await comoAna.dispose()
}
