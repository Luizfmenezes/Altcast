import { basename } from 'node:path'
import pg from 'pg'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { env } from './env.js'
import { runMigrations } from './db/migrate.js'
import { logger } from './shared/logger.js'
import { AppError, ERROR_CATALOG } from './shared/errors.js'
import { newId } from './shared/ids.js'
import { authRoutes } from './routes/auth.routes.js'
import type { Correio } from './email/tipos.js'
import { groupsRoutes } from './routes/groups.routes.js'
import { invitesRoutes } from './routes/invites.routes.js'
import { channelsRoutes } from './routes/channels.routes.js'
import { messagesRoutes } from './routes/messages.routes.js'
import { chatRicoRoutes } from './routes/chatRico.routes.js'
import { attachmentsRoutes } from './routes/attachments.routes.js'
import { armazemPadrao, LIMITE_POR_ARQUIVO, type Armazem } from './media/armazenamento.js'
import { gatewayRoutes } from './realtime/gateway.js'
import { metricsRoutes } from './routes/metrics.routes.js'
import { agendarLimpeza } from './cli/cleanup.js'

const METODOS_DE_ESCRITA = ['POST', 'PATCH', 'DELETE', 'PUT']

/** Spec 03 secao 6: demais rotas, 300 por minuto por usuario. */
const LIMITE_PADRAO_POR_MINUTO = 300

/**
 * `armazem` existe para o teste poder exercitar upload e download sem subir um
 * MinIO — o mesmo motivo da `SalaDeMidia` injetavel no cliente. Em producao
 * ninguem passa nada e vale `armazemPadrao()`, lido do ambiente.
 */
export type OpcoesDoServidor = {
  armazem?: Armazem | null
  /**
   * Injetado pelo mesmo motivo do armazem: um teste que precisasse de rede
   * para verificar que o link de recuperacao esta certo seria um teste que
   * ninguem roda. Sem isto, cai no correio escolhido pelo ambiente.
   */
  correio?: Correio
}

export async function buildServer(opcoes: OpcoesDoServidor = {}): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: () => newId(),
    // Em producao a requisicao chega depois de dois saltos — Nginx Proxy
    // Manager termina o TLS e o Caddy serve o estatico — e o `req.ip` cru
    // seria o endereco do container do Caddy. Todos os visitantes viram um so
    // IP, e o limite de 3 cadastros por hora POR IP vira 3 por hora no site
    // inteiro. Com a confianca ligada, o Fastify le o X-Forwarded-For e
    // recupera o endereco de quem realmente chamou.
    trustProxy: env.TRUST_PROXY,
  })

  await app.register(cookie)

  // O teto vive aqui e nao so na rota: o plugin corta o fluxo assim que passa,
  // em vez de deixar o processo receber 4 GB na memoria para so depois
  // recusar. `files: 1` porque cada anexo sobe numa requisicao propria — e o
  // que da progresso por arquivo e permite descartar um sem refazer os outros.
  await app.register(multipart, { limits: { fileSize: LIMITE_POR_ARQUIVO, files: 1 } })

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

  await app.register(authRoutes, opcoes.correio === undefined ? {} : { correio: opcoes.correio })
  await app.register(groupsRoutes)
  await app.register(invitesRoutes)
  await app.register(channelsRoutes)
  await app.register(messagesRoutes)
  await app.register(chatRicoRoutes)
  // `armazemPadrao()` devolve null quando o operador nao configurou storage.
  // A API sobe inteira assim mesmo e so a rota de anexo responde 503 — texto
  // que funciona vale mais que um processo que se recusa a arrancar.
  await app.register(attachmentsRoutes(opcoes.armazem ?? armazemPadrao()))
  await app.register(gatewayRoutes)
  await app.register(metricsRoutes)


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
  agendarLimpeza()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })

  // Sem isto o container so morre no SIGKILL do orquestrador, derrubando
  // conexoes abertas em vez de encerra-las.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void app.close().then(() => process.exit(0))
    })
  }
}
