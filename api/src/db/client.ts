import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.js'
import * as schema from './schema.js'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL })

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema })

export type Db = typeof db
export { schema }
