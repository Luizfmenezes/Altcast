import { and, count, eq } from 'drizzle-orm'
import { db, type Database } from '../db/client.js'
import { groups, users } from '../db/schema.js'
import { AppError } from '../shared/errors.js'

/**
 * Quantos grupos uma pessoa pode CRIAR.
 *
 * Mora aqui, e nao em `can.ts`, pela mesma razao que `auth/verificacao.ts`:
 * `can()` responde "este papel, neste recurso, pode esta acao?" — e quantos
 * grupos alguem ja criou nao e papel nem pertencimento. Enfia-la la dentro
 * obrigaria a mudar a assinatura de `can()` e a refazer uma tabela-verdade com
 * cobertura obrigatoria de 100%, para expressar algo que nao e permissao de
 * grupo, e sim cota.
 *
 * Conta so o que a pessoa e DONA (`groups.owner_id`). Participar de grupo por
 * convite e ilimitado: o teto existe contra quem fabrica grupos, nao contra
 * quem e convidado para muitos. Conversa direta tambem nao conta: abrir uma
 * conversa nao e fabricar grupo, mesmo que por dentro ela seja um.
 */

export const MAXIMO_DE_GRUPOS_POR_PESSOA = 3

/** Qualquer coisa que saiba consultar: o `db` global ou uma transacao. */
type Executor = Pick<Database, 'select'>

/**
 * Quantos grupos esta pessoa criou, e qual o teto dela.
 *
 * `max: null` significa sem teto — e o administrador da plataforma. Serve a
 * tela: o botao de criar grupo precisa saber "2 de 3" ANTES de a pessoa tentar
 * e levar um erro na cara.
 */
export async function cotaDeGrupos(
  userId: string, executor: Executor = db,
): Promise<{ used: number; max: number | null }> {
  const [u] = await executor.select({ admin: users.isPlatformAdmin })
    .from(users).where(eq(users.id, userId)).limit(1)

  const [c] = await executor.select({ n: count() })
    .from(groups).where(and(eq(groups.ownerId, userId), eq(groups.kind, 'group')))

  return {
    used: c?.n ?? 0,
    max: u?.admin === true ? null : MAXIMO_DE_GRUPOS_POR_PESSOA,
  }
}

/**
 * Confere o teto e recusa a criacao quando ele ja foi atingido.
 *
 * Chamar SEMPRE como primeira instrucao da transacao que insere o grupo: o
 * `FOR UPDATE` abaixo so vale enquanto a transacao vive, e o lock morre no
 * commit.
 *
 * Por que trava a linha do usuario em vez de so contar: sem lock, dois
 * `POST /api/groups` simultaneos da mesma pessoa leem "2" os dois, os dois
 * passam, e ela termina com quatro grupos. A linha de `users` precisa ser lida
 * de qualquer jeito para saber se e administrador, entao o lock sai de graca —
 * e um lock de LINHA e liberado pelo commit OU pelo rollback sozinho, ao
 * contrario de um advisory lock de sessao, que vaza se alguem escolher a
 * variante errada.
 */
export async function assertPodeCriarGrupo(
  tx: Executor, userId: string,
): Promise<void> {
  const [u] = await tx.select({ admin: users.isPlatformAdmin })
    .from(users).where(eq(users.id, userId)).limit(1).for('update')

  // A sessao e valida mas o usuario sumiu do banco: nao ha a quem cobrar cota.
  if (!u) throw new AppError('unauthenticated')
  if (u.admin) return

  const [c] = await tx.select({ n: count() })
    .from(groups).where(and(eq(groups.ownerId, userId), eq(groups.kind, 'group')))

  if ((c?.n ?? 0) >= MAXIMO_DE_GRUPOS_POR_PESSOA) {
    throw new AppError('group_limit_reached')
  }
}
