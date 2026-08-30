import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { AppError } from '../shared/errors.js'

/**
 * Exige e-mail confirmado.
 *
 * Mora AQUI, e nao em `can.ts`, e a distincao importa: `can()` responde "este
 * papel, neste recurso, pode esta acao?" — e conta descartavel nao e papel nem
 * pertencimento. Enfia-la la dentro obrigaria a mudar a assinatura de `can()` e
 * a refazer uma tabela-verdade de sessenta casos com cobertura de 100%, para
 * expressar algo que nao e uma permissao de grupo.
 *
 * O que isto protege e estreito de proposito: criar grupo e emitir convite. Ler
 * e escrever continuam livres para quem acabou de chegar — exigir confirmacao
 * para conversar transformaria o cadastro aberto numa promessa vazia.
 */
export async function assertEmailVerificado(userId: string): Promise<void> {
  const [u] = await db
    .select({ verificadoEm: users.emailVerifiedAt })
    .from(users).where(eq(users.id, userId)).limit(1)

  if (!u || u.verificadoEm === null) throw new AppError('email_not_verified')
}
