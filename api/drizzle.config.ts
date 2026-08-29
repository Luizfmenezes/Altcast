import { defineConfig } from 'drizzle-kit'

/** As migracoes sao escritas a mao em SQL puro (spec 02) e aplicadas por
 *  src/db/migrate.ts. Esta config existe para os comandos de inspecao do
 *  drizzle-kit, nao para gerar migracoes. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://altcast:altcast_dev@localhost:5432/altcast',
  },
})
