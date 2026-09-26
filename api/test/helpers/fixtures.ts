import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Database } from '../../src/db/client.js'
import {
  channelMembers, channels, groupMembers, groups, memberRoles, roles, users,
} from '../../src/db/schema.js'
import { PERMISSOES_DE_ADMIN, PERMISSOES_DE_TODOS } from '../../src/permissions/acoes.js'
import { hashPassword } from '../../src/auth/password.js'
import { newId } from '../../src/shared/ids.js'

export async function criarUsuario(
  db: Database,
  opts: {
    email: string
    senha?: string
    displayName?: string
    /**
     * Confirmado por padrao, e nao o contrario.
     *
     * A conta destes cenarios representa quem ja usa o sistema, e a migracao
     * 0008 marca exatamente essas como confirmadas — elas entraram por convite,
     * que e prova mais forte que um clique em link. Nascer sem confirmar faria
     * cada teste de grupo esbarrar no gate de e-mail e testar o gate em vez do
     * que ele quer testar.
     */
    verificado?: boolean
    /** Administrador da plataforma: sem teto de grupos criados. */
    platformAdmin?: boolean
  },
): Promise<string> {
  const id = newId()
  await db.insert(users).values({
    id,
    email: opts.email,
    passwordHash: opts.senha ? await hashPassword(opts.senha) : 'sem-senha',
    displayName: opts.displayName ?? opts.email.split('@')[0] ?? 'Alguem',
    emailVerifiedAt: (opts.verificado ?? true) ? new Date() : null,
    isPlatformAdmin: opts.platformAdmin ?? false,
  })
  return id
}

/**
 * Semeia num grupo os mesmos dois cargos que a rota de criacao cria e que a
 * migracao 0013 semeou nos grupos que ja existiam.
 *
 * Os cenarios inserem grupos direto no banco, sem passar pela rota. Sem esta
 * funcao eles cairiam no fallback de `loadGroupActor` — o caminho que resolve
 * permissao pelo papel antigo — e a suite inteira passaria sem nunca exercitar
 * a resolucao por cargo, que e justamente o que mudou. Com ela, cada teste que
 * ja existia vira tambem um teste de que os cargos reproduzem o
 * comportamento antigo.
 */
export async function semearCargos(db: Database, grupo: string): Promise<{
  todos: string; administrador: string
}> {
  const todos = newId()
  const administrador = newId()
  await db.insert(roles).values([
    {
      id: todos, groupId: grupo, name: 'todos', color: null, position: 0,
      permissions: [...PERMISSOES_DE_TODOS], isDefault: true,
    },
    {
      id: administrador, groupId: grupo, name: 'Administrador', color: '#5865F2',
      position: 10, permissions: [...PERMISSOES_DE_ADMIN], isDefault: false,
    },
  ])
  // Quem e `admin` em group_members recebe o cargo, como na migracao. O dono
  // nao: ele atravessa a concessao pelo `ehDono`.
  const admins = await db.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(eq(groupMembers.groupId, grupo))
  for (const a of admins) {
    const [linha] = await db.select({ role: groupMembers.role }).from(groupMembers)
      .where(and(eq(groupMembers.groupId, grupo), eq(groupMembers.userId, a.userId)))
    const { role: papel } = linha!
    if (papel === 'admin') {
      await db.insert(memberRoles).values({ groupId: grupo, userId: a.userId, roleId: administrador })
    }
  }
  return { todos, administrador }
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

  // Os cargos entram aqui para que TODO teste que usa este cenario passe pela
  // resolucao por cargo, e nao pelo fallback do papel antigo.
  await semearCargos(db, grupo)

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
  // O cargo, e nao so a coluna. Depois dos cargos, `group_members.role` e o
  // rotulo e a titularidade; o poder vem do conjunto resolvido. Inserir a
  // linha sem o cargo criaria um "administrador" sem nenhuma permissao de
  // administrador — um cenario que nao existe pela rota, e que so faria os
  // testes medirem o fallback.
  const [cargoAdmin] = await db.select({ id: roles.id }).from(roles)
    .where(and(eq(roles.groupId, groupId), eq(roles.name, 'Administrador'))).limit(1)
  await db.insert(memberRoles)
    .values({ groupId, userId: admin.userId, roleId: cargoAdmin!.id })

  return {
    groupId,
    cookieDono: dono.cookie, ownerId: dono.userId,
    cookieAdmin: admin.cookie, adminId: admin.userId,
  }
}
