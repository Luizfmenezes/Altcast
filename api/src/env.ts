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
  // Correio. Opcional pelo mesmo motivo da voz e dos anexos: sem a chave a API
  // sobe inteira e cai no correio de registro, que escreve a mensagem no log
  // em vez de envia-la. Em desenvolvimento isso e o suficiente para percorrer
  // o fluxo de recuperacao de ponta a ponta; em producao, a falta da chave
  // deixaria alguem sem caminho de volta para a propria conta.
  RESEND_API_KEY: z.string().optional(),
  // Precisa ser de um dominio verificado no Resend, senao ele recusa o envio.
  EMAIL_FROM: z.string().default('Altcast <nao-responda@altcast.local>'),
  EMAIL_REPLY_TO: z.string().optional(),
  // Armazenamento de anexos. Opcionais pelo mesmo motivo da voz: sem elas a
  // API sobe inteira, o texto funciona e so o anexo devolve 503 explicito.
  // Nada aqui vaza para o navegador — o cliente nunca fala com o storage.
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default('altcast'),
  // Falso porque o destino e a rede interna do compose, onde nao ha
  // certificado nem terceiro escutando. Um S3 externo pediria true.
  STORAGE_USE_SSL: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
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
