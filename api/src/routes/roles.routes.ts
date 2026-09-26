import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import { groupMembers, memberRoles, roles } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { alturaDe, assertCan, loadGroupActor } from '../permissions/context.js'
import { CATALOGO, apenasAcoes, type Action } from '../permissions/acoes.js'
import type { Actor } from '../permissions/can.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { parse, uuidOu404 } from './groups.routes.js'

/**
 * Cargos: criar, editar, apagar e atribuir.
 *
 * Tres invariantes sustentam este arquivo, e nenhuma delas e opcional:
 *
 * 1. **So se mexe no que esta abaixo.** Quem gerencia cargos nao alcanca um
 *    cargo na propria altura ou acima dela. Sem isso, o primeiro moderador
 *    criado apaga o cargo de quem o criou.
 * 2. **Ninguem concede o que nao tem.** Um cargo nao pode receber uma
 *    permissao que quem o edita nao possui. Sem isso, "gerenciar cargos" e um
 *    atalho para todas as outras permissoes, e a tela de permissoes vira
 *    decoracao.
 * 3. **O dono atravessa as duas.** E a mesma saida de emergencia de `can.ts`:
 *    sem ela, uma configuracao errada tranca o grupo e nao ha suporte para
 *    chamar.
 */

/** Acima disto a lista de membros fica ilegivel, e a tela de cargos tambem. */
const TETO_DE_CARGOS = 25

const nome = z.string().trim().min(1).max(32)
const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable()
const permissoes = z.array(z.string()).max(64)

const criarSchema = z.object({
  name: nome,
  color: cor.optional(),
  permissions: permissoes.optional(),
})

const atualizarSchema = z.object({
  name: nome.optional(),
  color: cor.optional(),
  position: z.int().min(1).max(1_000_000).optional(),
  permissions: permissoes.optional(),
})

const atribuirSchema = z.object({ roleIds: z.array(z.uuid()).max(TETO_DE_CARGOS) })

type RoleRow = typeof roles.$inferSelect

function serializar(r: RoleRow): Record<string, unknown> {
  return {
    id: r.id, groupId: r.groupId, name: r.name, color: r.color,
    position: r.position, permissions: apenasAcoes(r.permissions),
    isDefault: r.isDefault,
  }
}

/**
 * A altura de quem age, para comparar com a do cargo.
 *
 * O dono recebe `Infinity` pelo mesmo motivo que em `alturaDe`: ele precisa
 * alcancar todo cargo do grupo, inclusive o mais alto, senao um cargo criado
 * acima dele o trancaria para fora da propria configuracao.
 */
function alturaDoAtor(actor: Actor): number {
  return actor.ehDono ? Number.POSITIVE_INFINITY : actor.topo
}

/** Cargo estritamente abaixo de quem age. Igual NAO passa: dois cargos na
 *  mesma altura se apagariam um ao outro. */
function exigirAbaixo(actor: Actor, posicao: number): void {
  if (alturaDoAtor(actor) <= posicao) throw new AppError('role_above_you')
}

/**
 * Recusa conceder o que quem edita nao tem.
 *
 * Compara contra o conjunto JA RESOLVIDO do ator — que e o mesmo que `can`
 * consulta — e nao contra o cargo dele. Quem tem a permissao por dois cargos
 * diferentes continua podendo concede-la, o que e o resultado certo.
 */
function exigirQuePossua(actor: Actor, pedidas: readonly Action[]): void {
  if (actor.ehDono) return
  const minhas = actor.permissoes
  if (minhas === null) throw new AppError('not_found')
  for (const a of pedidas) if (!minhas.has(a)) throw new AppError('cannot_grant_unheld')
}

async function cargoOu404(groupId: string, roleId: string): Promise<RoleRow> {
  const [r] = await db.select().from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.groupId, groupId))).limit(1)
  if (!r) throw new AppError('not_found')
  return r
}

/** `23505` e a violacao de unicidade do Postgres — aqui, o nome repetido. */
function ehNomeRepetido(err: unknown): boolean {
  for (let atual = err, salto = 0; atual != null && salto < 4; salto++) {
    if ((atual as { code?: unknown }).code === '23505') return true
    atual = (atual as { cause?: unknown }).cause
  }
  return false
}

export async function rolesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * O catalogo de permissoes, para a tela desenhar.
   *
   * Vem do servidor, e nao de uma copia no cliente, porque quem acrescenta uma
   * `Action` mexe em `acoes.ts` — e assim nunca existe o estado em que a
   * permissao existe, vale, e nenhuma tela sabe explicar o que ela faz.
   */
  app.get('/api/permissions/catalog', { preHandler: requireAuth }, async () => CATALOGO)

  /** Ver os cargos e ver o grupo: quem pertence precisa saber quem e quem. */
  app.get('/api/groups/:id/roles', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    const linhas = await db.select().from(roles)
      .where(eq(roles.groupId, groupId))
      .orderBy(desc(roles.position), asc(roles.name))
    return linhas.map(serializar)
  })

  /** Quem tem qual cargo, para a lista de membros pintar os nomes. */
  app.get('/api/groups/:id/member-roles', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    return db.select({ userId: memberRoles.userId, roleId: memberRoles.roleId })
      .from(memberRoles).where(eq(memberRoles.groupId, groupId))
  })

  app.post('/api/groups/:id/roles', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.manage_roles', { kind: 'group' })

    const dados = parse(criarSchema, req.body ?? {})
    const pedidas = apenasAcoes(dados.permissions ?? [])
    exigirQuePossua(actor, pedidas)

    const [quantos] = await db.select({ n: count() }).from(roles).where(eq(roles.groupId, groupId))
    if ((quantos?.n ?? 0) >= TETO_DE_CARGOS) throw new AppError('role_limit_reached')

    // Nasce logo abaixo de quem criou. Nunca no topo: um cargo novo que ja
    // nascesse acima do criador o trancaria para fora dele no instante
    // seguinte, e a unica saida seria o dono.
    const [maisAlto] = await db.select({ position: roles.position }).from(roles)
      .where(eq(roles.groupId, groupId)).orderBy(desc(roles.position)).limit(1)
    const teto = alturaDoAtor(actor)
    const desejada = (maisAlto?.position ?? 0) + 1
    const position = Number.isFinite(teto) ? Math.min(desejada, teto - 1) : desejada
    // Grupo em que quem gerencia esta na altura 1: nao sobra degrau abaixo
    // dele, e criar um cargo ali seria criar um cargo que ele nao pode editar.
    if (position < 1) throw new AppError('role_above_you')

    const id = newId()
    try {
      await db.insert(roles).values({
        id, groupId, name: dados.name, color: dados.color ?? null,
        position, permissions: pedidas, isDefault: false,
      })
    } catch (err) {
      if (!ehNomeRepetido(err)) throw err
      throw new AppError('role_name_taken')
    }

    const criado = await cargoOu404(groupId, id)
    await emit.toGroup(groupId, { t: 'role.created', d: serializar(criado) })
    return reply.status(201).send(serializar(criado))
  })

  app.patch('/api/groups/:id/roles/:roleId', { preHandler: requireAuth }, async req => {
    const p = req.params as { id: string; roleId: string }
    const groupId = uuidOu404(p.id)
    const roleId = uuidOu404(p.roleId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.manage_roles', { kind: 'group' })

    const alvo = await cargoOu404(groupId, roleId)
    const dados = parse(atualizarSchema, req.body ?? {})

    if (alvo.isDefault) {
      // O cargo de todos tem as PERMISSOES editaveis — e para isso que ele
      // existe. O que nao muda e a identidade dele: renomear ou mover tiraria
      // da tela a unica linha que explica o que vale para quem nao tem cargo.
      if (dados.name !== undefined || dados.position !== undefined) {
        throw new AppError('default_role_locked')
      }
    } else {
      exigirAbaixo(actor, alvo.position)
    }

    if (dados.position !== undefined) exigirAbaixo(actor, dados.position)
    if (dados.permissions !== undefined) exigirQuePossua(actor, apenasAcoes(dados.permissions))

    try {
      await db.update(roles).set({
        ...(dados.name !== undefined ? { name: dados.name } : {}),
        ...(dados.color !== undefined ? { color: dados.color } : {}),
        ...(dados.position !== undefined ? { position: dados.position } : {}),
        ...(dados.permissions !== undefined
          ? { permissions: apenasAcoes(dados.permissions) }
          : {}),
      }).where(eq(roles.id, roleId))
    } catch (err) {
      if (!ehNomeRepetido(err)) throw err
      throw new AppError('role_name_taken')
    }

    const atualizado = await cargoOu404(groupId, roleId)
    await emit.toGroup(groupId, { t: 'role.updated', d: serializar(atualizado) })
    return serializar(atualizado)
  })

  app.delete('/api/groups/:id/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
    const p = req.params as { id: string; roleId: string }
    const groupId = uuidOu404(p.id)
    const roleId = uuidOu404(p.roleId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.manage_roles', { kind: 'group' })

    const alvo = await cargoOu404(groupId, roleId)
    if (alvo.isDefault) throw new AppError('default_role_locked')
    exigirAbaixo(actor, alvo.position)

    // `member_roles` e `channel_overwrites` do cargo caem junto: o primeiro por
    // ON DELETE CASCADE, o segundo nao — a excecao guarda um `subject_id` solto,
    // sem chave estrangeira, porque ele aponta ora para cargo ora para pessoa.
    await db.delete(roles).where(eq(roles.id, roleId))

    await emit.toGroup(groupId, { t: 'role.deleted', d: { id: roleId, groupId } })
    return reply.status(204).send()
  })

  /**
   * Os cargos de uma pessoa, de uma vez.
   *
   * Substitui o conjunto inteiro em vez de acrescentar e remover um a um: a
   * tela mostra caixas marcadas, e enviar o estado final e o que faz duas
   * edicoes simultaneas terminarem num estado que alguem escolheu — e nao na
   * soma acidental das duas.
   */
  app.put('/api/groups/:id/members/:userId/roles', { preHandler: requireAuth }, async req => {
    const p = req.params as { id: string; userId: string }
    const groupId = uuidOu404(p.id)
    const alvo = uuidOu404(p.userId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.change_role', {
      kind: 'group', topoDoAlvo: await alturaDe(alvo, groupId),
    })

    const [membro] = await db.select({ userId: groupMembers.userId }).from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo))).limit(1)
    if (!membro) throw new AppError('not_found')

    const { roleIds } = parse(atribuirSchema, req.body ?? {})
    const pedidos = roleIds.length === 0 ? [] : await db.select().from(roles)
      .where(and(eq(roles.groupId, groupId), inArray(roles.id, roleIds)))
    // Um id que nao e cargo deste grupo e 404, e nao "ignorado em silencio":
    // ignorar faria a tela mostrar um cargo atribuido que o banco nao guardou.
    if (pedidos.length !== roleIds.length) throw new AppError('not_found')

    for (const c of pedidos) {
      // O cargo de todos nao se atribui: ele ja vale para todo mundo, e
      // guarda-lo em `member_roles` faria a altura dele contar na hierarquia.
      if (c.isDefault) throw new AppError('default_role_locked')
      exigirAbaixo(actor, c.position)
    }

    // Os cargos que quem age NAO alcanca ficam como estao.
    //
    // Hoje isto e cinto e suspensorio: o portao de hierarquia logo acima ja
    // recusa o pedido inteiro quando o ALVO esta na altura de quem age ou
    // acima dela, e um membro abaixo nao tem, por definicao, cargo acima. A
    // guarda fica porque ela protege o dado, e nao o pedido: se um dia o
    // portao mudar — uma permissao de "editar cargos de qualquer um", uma
    // excecao para o proprio usuario —, a diferenca entre preservar e apagar
    // em silencio um cargo que a tela nem mostrou seria descoberta em
    // producao.
    const atuais = await db.select({ roleId: memberRoles.roleId, position: roles.position })
      .from(memberRoles).innerJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(and(eq(memberRoles.groupId, groupId), eq(memberRoles.userId, alvo)))
    const teto = alturaDoAtor(actor)
    const intocaveis = atuais.filter(c => c.position >= teto).map(c => c.roleId)

    const finais = [...new Set([...pedidos.map(c => c.id), ...intocaveis])]

    await db.transaction(async tx => {
      await tx.delete(memberRoles).where(and(
        eq(memberRoles.groupId, groupId), eq(memberRoles.userId, alvo),
      ))
      if (finais.length > 0) {
        await tx.insert(memberRoles).values(
          finais.map(roleId => ({ groupId, userId: alvo, roleId })),
        )
      }
    })

    const dados = { groupId, userId: alvo, roleIds: finais }
    await emit.toGroup(groupId, { t: 'member.roles_updated', d: dados })
    return dados
  })
}
