import { lt } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions } from '../db/schema.js'
import { logger } from '../shared/logger.js'

/** Uma vez por dia basta: sessao vencida ja nao autentica ninguem. */
export const INTERVALO_DE_LIMPEZA_MS = 24 * 60 * 60 * 1000

/**
 * Remove as sessoes vencidas.
 *
 * `validateSession` ja filtra por `expires_at`, entao a linha vencida nunca
 * autentica nada - a faxina existe para a tabela nao crescer para sempre com
 * lixo que so ocupa indice.
 */
export async function limparSessoesExpiradas(): Promise<number> {
  const resultado = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  return resultado.rowCount ?? 0
}

/**
 * Agenda a limpeza dentro do proprio processo da API.
 *
 * Para dez pessoas, um cron externo seria cerimonia sem retorno: mais uma peca
 * para instalar, monitorar e esquecer. O `unref` garante que este timer nunca
 * segure o processo em pe na hora de desligar.
 */
export function agendarLimpeza(): NodeJS.Timeout {
  const relogio = setInterval(() => {
    void limparSessoesExpiradas()
      .then(n => { if (n > 0) logger.info({ removidas: n }, 'sessoes expiradas removidas') })
      .catch(err => logger.error({ err }, 'falha na limpeza de sessoes'))
  }, INTERVALO_DE_LIMPEZA_MS)
  relogio.unref()
  return relogio
}

if (process.argv[1]?.includes('cleanup')) {
  const removidas = await limparSessoesExpiradas()
  console.log(`Sessoes expiradas removidas: ${removidas}`)
  process.exit(0)
}
