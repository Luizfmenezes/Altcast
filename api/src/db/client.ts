import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.js'
import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema>

let real: Database | undefined
let override: Database | undefined

function producao(): Database {
  // Preguicoso de proposito: importar este modulo em teste nao deve abrir
  // conexao com o banco de producao.
  real ??= drizzle(new pg.Pool({ connectionString: env.DATABASE_URL }), { schema })
  return real
}

function atual(): Database {
  return override ?? producao()
}

/**
 * Aponta `db` para outro banco. Existe para os testes de integracao: eles
 * sobem um Postgres em container e precisam que session.ts, context.ts e as
 * rotas escrevam NESSE banco, nao no de env.DATABASE_URL. Sem isto, o teste
 * insere o usuario num banco e a rota grava em outro.
 */
export function setDatabase(d: Database): void { override = d }
export function clearDatabase(): void { override = undefined }

/**
 * Fachada estavel: os modulos importam `db` uma vez, e a instancia por tras
 * pode trocar. O bind preserva o `this` dos metodos do drizzle.
 */
export const db: Database = new Proxy({} as Database, {
  get(_alvo, prop) {
    const inst = atual() as unknown as Record<string | symbol, unknown>
    const valor = inst[prop]
    return typeof valor === 'function' ? valor.bind(inst) : valor
  },
})

export { schema }
