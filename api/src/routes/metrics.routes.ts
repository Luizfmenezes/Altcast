import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { requireAuth } from '../auth/middleware.js'
import { registry } from '../realtime/registry.js'
import { presence } from '../realtime/presence.js'

/**
 * Metricas operacionais, em rota autenticada.
 *
 * Sem Prometheus e sem Grafana nesta fatia: para uma instancia e dez pessoas,
 * um JSON que se le com `curl` responde as perguntas que realmente aparecem -
 * "tem gente conectada?" e "o banco esta lento?". Montar uma pilha de
 * observabilidade antes de existir a pergunta e construir o painel de um aviao
 * que ainda nao voa.
 *
 * Exige sessao valida porque contagem de conexoes e sinal de uso, e sinal de
 * uso e informacao sobre quem usa.
 */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/metrics', { preHandler: requireAuth }, async () => {
    const inicio = process.hrtime.bigint()
    await db.execute(sql`SELECT 1`)
    const latenciaDoBancoMs = Number(process.hrtime.bigint() - inicio) / 1_000_000

    const usuarios = registry.userIds()
    return {
      conexoesAtivas: usuarios.reduce((total, u) => total + registry.connectionsOf(u), 0),
      usuariosOnline: usuarios.filter(u => presence.isOnline(u)).length,
      latenciaDoBancoMs: Number(latenciaDoBancoMs.toFixed(2)),
      memoriaMb: Number((process.memoryUsage().rss / 1_048_576).toFixed(1)),
      uptimeSegundos: Math.round(process.uptime()),
    }
  })
}
