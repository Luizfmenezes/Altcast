import type { FastifyInstance } from 'fastify'
import type { Database } from '../../src/db/client.js'
import { channelMembers, channels, groupMembers, groups, users } from '../../src/db/schema.js'
import { hashPassword } from '../../src/auth/password.js'
import { newId } from '../../src/shared/ids.js'

export async function criarUsuario(
  db: Database,
  opts: { email: string; senha?: string; displayName?: string },
): Promise<string> {
  const id = newId()
  await db.insert(users).values({
    id,
    email: opts.email,
    passwordHash: opts.senha ? await hashPassword(opts.senha) : 'sem-senha',
    displayName: opts.displayName ?? opts.email.split('@')[0] ?? 'Alguem',
  })
  return id
}

export type CenarioPrivado = {
  grupo: string
  canal: string
  canalPublico: string
  owner: string
  admin: string
  membroDentro: string
  membroFora: string
  estranho: string
}

/**
 * Grupo com owner, admin e dois members, mais um canal privado que contem
 * apenas `membroDentro`. `estranho` nao pertence ao grupo.
 *
 * O admin fica deliberadamente FORA do canal privado: e o cenario que prova o
 * eixo duplo da spec 03 — administrar vem do papel, ler vem do pertencimento.
 */
export async function cenarioPrivado(db: Database): Promise<CenarioPrivado> {
  const owner = await criarUsuario(db, { email: 'owner@x.com', displayName: 'Owner' })
  const admin = await criarUsuario(db, { email: 'admin@x.com', displayName: 'Admin' })
  const membroDentro = await criarUsuario(db, { email: 'dentro@x.com', displayName: 'Dentro' })
  const membroFora = await criarUsuario(db, { email: 'fora@x.com', displayName: 'Fora' })
  const estranho = await criarUsuario(db, { email: 'estranho@x.com', displayName: 'Estranho' })

  const grupo = newId()
  await db.insert(groups).values({ id: grupo, name: 'Time', ownerId: owner })
  await db.insert(groupMembers).values([
    { groupId: grupo, userId: owner, role: 'owner' },
    { groupId: grupo, userId: admin, role: 'admin' },
    { groupId: grupo, userId: membroDentro, role: 'member' },
    { groupId: grupo, userId: membroFora, role: 'member' },
  ])

  const canal = newId()
  await db.insert(channels).values({
    id: canal, groupId: grupo, name: 'diretoria', visibility: 'private', position: 1,
  })
  await db.insert(channelMembers).values({ channelId: canal, userId: membroDentro, addedBy: owner })

  const canalPublico = newId()
  await db.insert(channels).values({
    id: canalPublico, groupId: grupo, name: 'geral', visibility: 'public', position: 0,
  })

  return { grupo, canal, canalPublico, owner, admin, membroDentro, membroFora, estranho }
}

/**
 * Cria a conta e faz login de verdade, devolvendo o cookie de sessao.
 *
 * `remoteAddress` existe para os testes que criam varias contas de uma vez: o
 * login e limitado a 5 por minuto por IP, e sem enderecos distintos a sexta
 * chamada voltaria 429 em vez do cookie.
 */
export async function loginComo(
  app: FastifyInstance,
  db: Database,
  email: string,
  senha = 'senha-longa-boa',
  remoteAddress?: string,
): Promise<{ cookie: string; userId: string }> {
  const userId = await criarUsuario(db, { email, senha })
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password: senha },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  })
  const cookie = (res.headers['set-cookie'] as string).split(';')[0]!
  return { cookie, userId }
}

/**
 * Grupo criado pela rota (portanto com #geral e o vinculo de owner reais),
 * mais um admin. Serve aos testes que precisam provar o que o admin NAO pode.
 */
export async function cenarioComAdmin(
  app: FastifyInstance,
  db: Database,
): Promise<{
  groupId: string
  cookieDono: string; ownerId: string
  cookieAdmin: string; adminId: string
}> {
  const dono = await loginComo(app, db, 'dono@x.com')
  const res = await app.inject({
    method: 'POST', url: '/api/groups',
    headers: { cookie: dono.cookie }, payload: { name: 'Time' },
  })
  const groupId = res.json().id as string

  const admin = await loginComo(app, db, 'admin@x.com')
  await db.insert(groupMembers).values({ groupId, userId: admin.userId, role: 'admin' })

  return {
    groupId,
    cookieDono: dono.cookie, ownerId: dono.userId,
    cookieAdmin: admin.cookie, adminId: admin.userId,
  }
}
