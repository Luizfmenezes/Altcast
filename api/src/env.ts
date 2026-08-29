import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  ALLOWED_ORIGINS: z.string().transform(s => s.split(',').map(v => v.trim())),
  PUBLIC_URL: z.url(),
  SESSION_COOKIE_NAME: z.string().default('altcast_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const linhas = r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Variaveis de ambiente invalidas:\n${linhas.join('\n')}`)
  }
  return Object.freeze(r.data)
}

/** Validado no import: o processo morre no arranque se faltar variavel,
 *  em vez de subir pela metade e falhar depois em producao. */
export const env: Env = parseEnv(process.env)
