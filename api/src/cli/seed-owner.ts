import { channels, groupMembers, groups, users } from '../db/schema.js'
import { db } from '../db/client.js'
import { assertPasswordAcceptable, hashPassword } from '../auth/password.js'
import { newId } from '../shared/ids.js'
import { env } from '../env.js'

/**
 * Bootstrap do primeiro usuario. Roda uma unica vez, por CLI dentro do
 * container. Idempotente por recusa: se ja existir qualquer usuario, aborta.
 *
 * Existe porque nao ha cadastro avulso — criar conta exige convite, e o
 * primeiro convite precisa de alguem para emiti-lo.
 */
export async function seedOwner(): Promise<void> {
  const email = env.SEED_OWNER_EMAIL
  const senha = env.SEED_OWNER_PASSWORD
  if (!email || !senha) {
    console.error('Defina SEED_OWNER_EMAIL e SEED_OWNER_PASSWORD antes de rodar o seed.')
    process.exit(1)
  }

  const [existente] = await db.select({ id: users.id }).from(users).limit(1)
  if (existente) {
    console.error('Ja existe usuario. Seed abortado.')
    process.exit(1)
  }

  assertPasswordAcceptable(senha)

  const userId = newId()
  const groupId = newId()
  const channelId = newId()

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(senha),
    displayName: email.split('@')[0] ?? 'Owner',
  })
  await db.insert(groups).values({ id: groupId, name: 'Anticorp', ownerId: userId })
  await db.insert(groupMembers).values({ groupId, userId, role: 'owner' })
  await db.insert(channels).values({
    id: channelId, groupId, name: 'geral', type: 'text', visibility: 'public', position: 0,
  })

  console.log('Usuario inicial criado:', email)
  console.log('Grupo "Anticorp" criado com o canal #geral.')
  console.log('Troque a senha no primeiro login.')
  // O convite inicial depende do gerador de codigo da Tarefa 9; ate la, gere
  // um convite pela interface depois de entrar.
}

if (process.argv[1]?.includes('seed-owner')) {
  await seedOwner()
  process.exit(0)
}
