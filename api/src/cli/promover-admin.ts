import { eq } from 'drizzle-orm'
import { users } from '../db/schema.js'
import { db } from '../db/client.js'

/**
 * Promove uma conta a administradora da PLATAFORMA, ou tira essa condicao.
 *
 * Serve a uma coisa so: ficar sem o teto de tres grupos criados. Nao concede
 * nada dentro de grupo nenhum — papel continua sendo por grupo e continua
 * sendo decidido por `can.ts`.
 *
 * Por CLI, e nao por rota: quem roda isto tem acesso ao container, o que e
 * prova mais forte do que qualquer sessao. Abrir uma rota para promover
 * administrador criaria uma superficie de escalada de privilegio para ganhar
 * uma comodidade que ninguem pediu.
 *
 *   npm --workspace api run admin:promote -- pessoa@exemplo.com
 *   npm --workspace api run admin:promote -- pessoa@exemplo.com --remover
 */
export async function promoverAdmin(email: string, remover: boolean): Promise<void> {
  const [u] = await db.select({ id: users.id, admin: users.isPlatformAdmin })
    .from(users).where(eq(users.email, email)).limit(1)

  if (!u) {
    console.error(`Nenhuma conta com o endereco ${email}.`)
    process.exit(1)
  }

  const alvo = !remover
  if (u.admin === alvo) {
    console.log(`${email} ja esta ${alvo ? 'promovida' : 'sem a promocao'}. Nada a fazer.`)
    return
  }

  await db.update(users).set({ isPlatformAdmin: alvo }).where(eq(users.id, u.id))
  console.log(alvo
    ? `${email} agora e administradora da plataforma e nao tem teto de grupos.`
    : `${email} voltou ao teto de tres grupos criados.`)
}

if (process.argv[1]?.includes('promover-admin')) {
  const args = process.argv.slice(2)
  const email = args.find(a => !a.startsWith('--'))
  if (email === undefined) {
    console.error('Uso: npm --workspace api run admin:promote -- <email> [--remover]')
    process.exit(1)
  }
  await promoverAdmin(email, args.includes('--remover'))
  process.exit(0)
}
