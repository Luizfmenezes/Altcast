import { basename } from 'node:path'
import cookie from '@fastify/cookie'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { env } from './env.js'
import { logger } from './shared/logger.js'
import { AppError, ERROR_CATALOG } from './shared/errors.js'
import { newId } from './shared/ids.js'
import { authRoutes } from './routes/auth.routes.js'
import { groupsRoutes } from './routes/groups.routes.js'
import { invitesRoutes } from './routes/invites.routes.js'
import { channelsRoutes } from './routes/channels.routes.js'

const METODOS_DE_ESCRITA = ['POST', 'PATCH', 'DELETE', 'PUT']

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: () => newId(),
  })

  await app.register(cookie)

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


  return app
}

// Sobe o servidor apenas quando este arquivo e o ponto de entrada do processo.
// Aceita .ts e .js: em desenvolvimento o Node 24 executa o TypeScript direto,
// em producao roda o build compilado.
const entry = process.argv[1]
if (entry !== undefined && ['index.ts', 'index.js'].includes(basename(entry))) {
  const app = await buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
}
