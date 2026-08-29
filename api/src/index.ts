import { basename } from 'node:path'
import pg from 'pg'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { env } from './env.js'
import { runMigrations } from './db/migrate.js'
import { logger } from './shared/logger.js'
import { AppError, ERROR_CATALOG } from './shared/errors.js'
import { newId } from './shared/ids.js'
import { authRoutes } from './routes/auth.routes.js'
import { groupsRoutes } from './routes/groups.routes.js'
import { invitesRoutes } from './routes/invites.routes.js'
import { channelsRoutes } from './routes/channels.routes.js'
import { messagesRoutes } from './routes/messages.routes.js'
import { gatewayRoutes } from './realtime/gateway.js'

const METODOS_DE_ESCRITA = ['POST', 'PATCH', 'DELETE', 'PUT']

/** Spec 03 secao 6: demais rotas, 300 por minuto por usuario. */
const LIMITE_PADRAO_POR_MINUTO = 300

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: () => newId(),
  })

  await app.register(cookie)

  // Contadores em memoria: um unico processo na Fatia 1. A chave e o cookie de
  // sessao quando existe, e o IP quando nao — `req.user` so e preenchido pelo
  // preHandler de autenticacao, que roda DEPOIS deste hook.
  await app.register(rateLimit, {
    global: true,
    max: LIMITE_PADRAO_POR_MINUTO,
    timeWindow: '1 minute',
    keyGenerator: req => req.cookies[env.SESSION_COOKIE_NAME] ?? req.ip,
  })

  // CSRF sem token dedicado: SameSite=Lax no cookie impede o envio em
  // requisicao cross-site de escrita, e esta checagem cobre o resto.
  app.addHook('onRequest', async req => {
    if (METODOS_DE_ESCRITA.includes(req.method)) {
      const origin = req.headers.origin
      if (origin !== undefined && !env.ALLOWED_ORIGINS.includes(origin)) {
        throw new AppError('forbidden')
      }
    }
  })

  // Antes de registrar rotas, de proposito: cada register() cria um contexto
  // encapsulado que herda o handler vigente NAQUELE momento. Definido depois,
  // as rotas cairiam no handler padrao do Fastify e devolveriam
  // { statusCode, error: 'Unauthorized' } em vez do envelope da spec 06.
  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id

    // O rate-limit lanca um erro proprio, com o Retry-After ja posto na
    // resposta. Sem esta traducao ele cairia no ramo de erro inesperado e o
    // cliente receberia 500 — perdendo justamente a informacao de quando
    // tentar de novo.
    const status = (err as { statusCode?: unknown }).statusCode
    if (!(err instanceof AppError) && status === 429) {
      req.log.info({ requestId }, 'limite de taxa atingido')
      return reply.status(429).send({
        error: {
          code: 'rate_limited',
          message: ERROR_CATALOG.rate_limited.message,
          requestId,
          details: null,
        },
      })
    }

    if (err instanceof AppError) {
      // 'errorCode' e nao 'code': o logger redige 'code' por causa dos
      // codigos de convite. Ver o comentario em shared/logger.ts.
      req.log.info({ requestId, errorCode: err.code }, 'erro de aplicacao')
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, requestId, details: err.details ?? null },
      })
    }
    req.log.error({ requestId, err }, 'erro inesperado')
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: ERROR_CATALOG.internal_error.message,
        requestId,
        details: null,
      },
    })
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes)
  await app.register(groupsRoutes)
  await app.register(invitesRoutes)
  await app.register(channelsRoutes)
  await app.register(messagesRoutes)
  await app.register(gatewayRoutes)


  return app
}

// Sobe o servidor apenas quando este arquivo e o ponto de entrada do processo.
// Aceita .ts e .js: em desenvolvimento o Node 24 executa o TypeScript direto,
// em producao roda o build compilado.
const entry = process.argv[1]
if (entry !== undefined && ['index.ts', 'index.js'].includes(basename(entry))) {
  // Migrar ANTES de aceitar trafego. Um container novo que ja recebesse
  // requisicao enquanto o schema ainda nao existe responderia 500 para os
  // primeiros usuarios de cada implantacao. O lock consultivo dentro de
  // runMigrations garante que varias instancias subindo juntas migrem uma de
  // cada vez, em vez de correrem.
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
  try {
    const aplicadas = await runMigrations(pool)
    if (aplicadas.length > 0) logger.info({ aplicadas }, 'migracoes aplicadas')
  } finally {
    await pool.end()
  }

  const app = await buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })

  // Sem isto o container so morre no SIGKILL do orquestrador, derrubando
  // conexoes abertas em vez de encerra-las.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void app.close().then(() => process.exit(0))
    })
  }
}
