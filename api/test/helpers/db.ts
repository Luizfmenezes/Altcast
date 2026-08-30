import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../../src/db/schema.js'
import { runMigrations } from '../../src/db/migrate.js'
import { setDatabase } from '../../src/db/client.js'

let container: StartedPostgreSqlContainer | undefined
let pool: pg.Pool | undefined
let pronto: Promise<NodePgDatabase<typeof schema>> | undefined

const TABELAS = [
  'messages', 'channel_members', 'channels', 'invites',
  // Caem pelo CASCADE de users, mas o contrato deste helper e a lista
  // explicita: um TRUNCATE que depende de cascata escondida e um TRUNCATE que
  // deixa de limpar no dia em que a chave estrangeira mudar.
  'password_reset_tokens', 'email_verification_tokens',
  'group_members', 'groups', 'sessions', 'users',
].join(', ')

async function iniciar(): Promise<NodePgDatabase<typeof schema>> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  // Migrador proprio: o do drizzle-orm exige migrations/meta/_journal.json
  // gerado pelo drizzle-kit, e a spec 02 pede SQL puro escrito a mao.
  await runMigrations(pool)
  const db = drizzle(pool, { schema })
  // Sem isto, session.ts / context.ts / rotas gravariam no banco de
  // env.DATABASE_URL enquanto o teste insere neste container.
  setDatabase(db)
  return db
}

/** Uma unica promessa compartilhada: subir container e caro. */
function ensure(): Promise<NodePgDatabase<typeof schema>> {
  pronto ??= iniciar()
  return pronto
}

/**
 * Roda `fn` contra um banco migrado e esvazia as tabelas ao final.
 * O alvo e sempre o Postgres efemero do Testcontainers, criado e destruido
 * pela propria suite — nunca um banco persistente.
 */
export async function withTestDb(
  fn: (db: NodePgDatabase<typeof schema>) => Promise<void>,
): Promise<void> {
  const db = await ensure()
  try {
    await fn(db)
  } finally {
    await pool!.query(`TRUNCATE ${TABELAS} CASCADE`)
  }
}

/** Derruba o container ao fim da suite; sem isso o vitest fica pendurado. */
export async function stopTestDb(): Promise<void> {
  await pool?.end()
  await container?.stop()
  pool = undefined
  container = undefined
  pronto = undefined
}
