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
  // Ligue APENAS quando houver um proxy reverso na frente (Caddy, e em
  // producao tambem o Nginx Proxy Manager). Sem isto, `req.ip` e o endereco
  // do proxy, e nao o do visitante: os limites de taxa por IP passariam a
  // contar todo mundo no mesmo balde e o terceiro cadastro do DIA — de
  // qualquer pessoa — levaria 429. Ligado onde nao ha proxy e o problema
  // espelhado: o cliente escolhe o proprio X-Forwarded-For e escapa do limite.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform(v => v === 'true'),
  // Usadas uma unica vez, por npm run seed:owner. Opcionais para que a API
  // suba sem elas depois do bootstrap.
  SEED_OWNER_EMAIL: z.string().optional(),
  SEED_OWNER_PASSWORD: z.string().optional(),
  // Midia. Opcionais de proposito: sem elas a API sobe inteira e apenas a
  // chamada fica indisponivel, com 503 explicito. Um texto que funciona vale
  // mais que um processo que se recusa a arrancar por falta de voz.
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
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
