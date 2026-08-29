import Fastify, { type FastifyInstance } from 'fastify'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}

// Sobe o servidor apenas quando este arquivo e o ponto de entrada do processo.
// Aceita .ts e .js: em desenvolvimento o Node 24 executa o TypeScript direto,
// em producao roda o build compilado.
const entry = process.argv[1]
if (entry !== undefined && /[\/]index\.(ts|js)$/.test(entry)) {
  const app = await buildServer()
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
}
