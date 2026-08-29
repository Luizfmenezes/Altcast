import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { env } from './env.js'
import { logger } from './shared/logger.js'
import { AppError, ERROR_CATALOG } from './shared/errors.js'
import { newId } from './shared/ids.js'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: () => newId(),
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

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

  return app
}

// Sobe o servidor apenas quando este arquivo e o ponto de entrada do processo.
// Aceita .ts e .js: em desenvolvimento o Node 24 executa o TypeScript direto,
// em producao roda o build compilado.
const entry = process.argv[1]
if (entry !== undefined && /[\/]index\.(ts|js)$/.test(entry)) {
  const app = await buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
}
