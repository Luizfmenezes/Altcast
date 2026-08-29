import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

/** Chave arbitraria e fixa do lock consultivo. Qualquer valor serve, desde que
 *  todas as instancias usem o mesmo. */
const LOCK_KEY = 8_273_401_119

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

/**
 * Aplica as migracoes .sql em ordem lexicografica, uma unica vez cada.
 *
 * Nao usa o migrator do drizzle-orm de proposito: ele exige um
 * migrations/meta/_journal.json gerado pelo drizzle-kit, e a spec 02 pede
 * migracoes em SQL puro escritas a mao. Este runner tambem entrega o lock
 * consultivo que a spec 07 secao 6 exige — um container migra por vez, os
 * demais aguardam em vez de correrem juntos.
 */
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect()
  const aplicadas: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations')
    const ja = new Set(rows.map(r => r.name))

    const arquivos = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const nome of arquivos) {
      if (ja.has(nome)) continue
      const sql = await readFile(join(MIGRATIONS_DIR, nome), 'utf8')
      // Cada migracao e atomica: ou aplica inteira e fica registrada, ou nada.
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [nome])
        await client.query('COMMIT')
        aplicadas.push(nome)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Falha na migracao ${nome}: ${(err as Error).message}`, { cause: err })
      }
    }
    return aplicadas
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}
