import { and, count, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  channelMembers, channels, groupMembers, groups, memberRoles, roles, users,
} from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertEmailVerificado } from '../auth/verificacao.js'
import { assertPodeCriarGrupo } from '../groups/limite.js'
import { cargosPadrao } from '../groups/cargosPadrao.js'
import { alturaDe, assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { audienceOfGroup } from '../realtime/fanout.js'
import {
  emitirEntradaEmGrupo, emitirGrupoApagado, emitirGrupoAtualizado,
} from '../groups/eventos.js'

const nome = z.string().trim().min(2).max(64)
const iconUrl = z.url().max(2048).nullable().optional()

const criarSchema = z.object({ name: nome, iconUrl })
const papelSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) })
const atualizarSchema = z.object({ name: nome.optional(), iconUrl })
  .refine(v => v.name !== undefined || v.iconUrl !== undefined, {
    error: 'Informe ao menos um campo.', path: ['name'],
  })

/**
 * zod devolve o mapa campo -> mensagens que a spec 06 exige em `details`.
 * A mensagem do envelope continua sendo a do catalogo; `details` e o que a
 * interface usa para destacar o campo errado.
 */
function parse<T>(schema: z.ZodType<T>, entrada: unknown): T {
  const r = schema.safeParse(entrada)
  if (!r.success) throw new AppError('validation_failed', z.flattenError(r.error).fieldErrors)
  return r.data
}

/**
 * Um `:id` que nao e UUID nunca chega ao banco: a coluna e uuid e o Postgres
 * responderia com erro de sintaxe, virando 500. Recurso inexistente e 404.
 */
function uuidOu404(valor: string): string {
  if (!z.uuid().safeParse(valor).success) throw new AppError('not_found')
  return valor
}

async function contarMembros(groupId: string): Promise<number> {
  const [linha] = await db.select({ n: count() }).from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return linha?.n ?? 0
}

async function carregarGrupo(groupId: string): Promise<typeof groups.$inferSelect> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  if (!g) throw new AppError('not_found')
  return g
}

/** O alvo precisa pertencer ao grupo; um userId qualquer nao vira membro novo. */
async function membroOu404(
  groupId: string, userId: string,
): Promise<typeof groupMembers.$inferSelect> {
  const [m] = await db.select().from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))).limit(1)
  if (!m) throw new AppError('not_found')
  return m
}

export async function groupsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/groups', { preHandler: requireAuth }, async (req, reply) => {
    const { name, iconUrl: icone } = parse(criarSchema, req.body)
    const userId = req.user!.id
    // Com cadastro aberto, criar grupo e a acao que uma conta descartavel
    // usaria para virar spam. Ler e escrever continuam livres a quem acabou de
    // chegar; so isto e emitir convite pedem endereco confirmado.
    await assertEmailVerificado(userId)
    const groupId = newId()

    // Tres insercoes ou nenhuma. Um grupo sem dono, ou sem canal, seria um
    // estado que nenhuma rota posterior sabe consertar.
    // Quatro insercoes ou nenhuma. Um grupo sem dono, sem canal ou sem cargo
    // padrao seria um estado que nenhuma rota posterior sabe consertar — e o
    // cargo padrao entrou nessa lista porque `loadGroupActor` resolve as
    // permissoes a partir dele: sem ele o grupo nasceria mudo.
    await db.transaction(async tx => {
      // PRIMEIRA instrucao da transacao, sempre: ela trava a linha do usuario,
      // e e esse lock que impede dois pedidos simultaneos de passarem os dois.
      await assertPodeCriarGrupo(tx, userId)
      await tx.insert(groups).values({ id: groupId, name, iconUrl: icone ?? null, ownerId: userId })
      await tx.insert(groupMembers).values({ groupId, userId, role: 'owner' })
      await tx.insert(channels).values({ id: newId(), groupId, name: 'geral', position: 0 })
      // Os mesmos dois cargos que a migracao 0013 semeou nos grupos que ja
      // existiam, e os mesmos que o `seed-owner` cria. Grupo novo, grupo
      // antigo e grupo de instalacao precisam nascer iguais — senao o
      // comportamento passa a depender de por qual porta o grupo entrou.
      await tx.insert(roles).values(cargosPadrao(groupId))
    })

    // Sem isto o grupo so aparecia depois de recarregar a pagina: nada no
    // sistema sabia avisar um cliente de que a lista de grupos DELE mudou.
    await emitirEntradaEmGrupo('group.created', userId, groupId, 'owner')

    return reply.status(201).send({
      id: groupId, name, iconUrl: icone ?? null, role: 'owner', memberCount: 1,
    })
  })

  app.get('/api/groups/:id', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
    if (!g) throw new AppError('not_found')

    return {
      id: g.id, name: g.name, iconUrl: g.iconUrl,
      createdAt: g.createdAt, role: actor.papel, memberCount: await contarMembros(groupId),
    }
  })

  app.patch('/api/groups/:id', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.update', { kind: 'group' })

    const campos = parse(atualizarSchema, req.body)
    const [g] = await db.update(groups)
      .set({
        ...(campos.name !== undefined ? { name: campos.name } : {}),
        ...(campos.iconUrl !== undefined ? { iconUrl: campos.iconUrl } : {}),
      })
      .where(eq(groups.id, groupId)).returning()
    if (!g) throw new AppError('not_found')

    // O icone ja emitia isto desde sempre (imagens.routes.ts); o NOME nunca
    // emitiu, e por isso renomear um grupo nao mudava nada na tela de
    // ninguem — nem na de quem renomeou.
    await emitirGrupoAtualizado(groupId, {
      ...(campos.name !== undefined ? { name: g.name } : {}),
      ...(campos.iconUrl !== undefined ? { iconUrl: g.iconUrl } : {}),
    })

    return {
      id: g.id, name: g.name, iconUrl: g.iconUrl,
      createdAt: g.createdAt, role: actor.papel, memberCount: await contarMembros(groupId),
    }
  })

  app.delete('/api/groups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.delete', { kind: 'group' })

    // Antes da remocao: apagar o grupo destroi a propria audiencia, e
    // perguntar depois devolveria lista vazia. Mesmo cuidado de `member.left`.
    const audiencia = await audienceOfGroup(groupId)

    // Membros, canais, convites, cargos e mensagens caem por ON DELETE CASCADE.
    await db.delete(groups).where(eq(groups.id, groupId))

    emitirGrupoApagado(audiencia, groupId)
    return reply.status(204).send()
  })

  app.get('/api/groups/:id/members', { preHandler: requireAuth }, async req => {
    const groupId = uuidOu404((req.params as { id: string }).id)
    const actor = await loadGroupActor(req.user!.id, groupId)
    assertCan(actor, 'group.view', { kind: 'group' })

    return db.select({
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId))
  })

  app.patch('/api/groups/:id/members/:userId', { preHandler: requireAuth }, async req => {
    const p = req.params as { id: string; userId: string }
    const groupId = uuidOu404(p.id)
    const alvo = uuidOu404(p.userId)

    const actor = await loadGroupActor(req.user!.id, groupId)
    // A hierarquia entra aqui: so se mexe em quem esta abaixo. O dono atravessa
    // a comparacao, e `alturaDe` devolve Infinity para ele — e assim "ninguem
    // rebaixa o dono" deixa de depender de uma guarda escrita a mao nesta rota.
    assertCan(actor, 'group.change_role', {
      kind: 'group', topoDoAlvo: await alturaDe(alvo, groupId),
    })

    // Desestruturado de proposito: a regra de lint proibe comparar `.role`
    // fora de can.ts, e com razao. Aqui o valor nao e o papel de ninguem — e o
    // papel PEDIDO no corpo, e a autorizacao ja foi decidida acima.
    const { role: novoPapel } = parse(papelSchema, req.body)

    const g = await carregarGrupo(groupId)
    const atual = await membroOu404(groupId, alvo)

    if (alvo === g.ownerId && novoPapel !== 'owner') {
      // Grupo sem dono nao existe. O indice unico parcial impede DOIS owners;
      // esta guarda impede ZERO.
      throw new AppError('owner_cannot_leave')
    }

    if (novoPapel === 'owner') {
      // O teto de tres grupos NAO e conferido aqui, de proposito: receber a
      // titularidade pode empurrar alguem acima do teto, e tudo bem. Recusar a
      // transferencia prenderia o grupo no dono que quer sair — e
      // `owner_cannot_leave` ja faz da transferencia a unica saida dele. Quem
      // passa do teto apenas nao cria grupos NOVOS ate voltar para baixo.
      //
      // Rebaixar antes de promover. Na ordem inversa, group_one_owner_idx
      // recusaria a transacao — e esse e exatamente o papel dele: transformar
      // um erro de logica em erro de banco.
      await db.transaction(async tx => {
        await tx.update(groupMembers).set({ role: 'admin' })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'owner')))
        await tx.update(groupMembers).set({ role: 'owner' })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))
        await tx.update(groups).set({ ownerId: alvo }).where(eq(groups.id, groupId))
      })
    } else {
      // O papel e o cargo andam juntos, e precisam andar.
      //
      // Depois dos cargos, `group_members.role` deixou de ser a fonte das
      // permissoes — quem decide e o conjunto resolvido em `context.ts`. Se
      // esta rota so trocasse a coluna, promover alguem a administrador
      // mudaria o ROTULO na lista de membros e nao mudaria poder nenhum: a
      // interface mentindo sobre permissao, que e o defeito mais caro que uma
      // tela de cargos pode ter.
      await db.transaction(async tx => {
        await tx.update(groupMembers).set({ role: novoPapel })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))

        const [cargoAdmin] = await tx.select({ id: roles.id }).from(roles)
          .where(and(eq(roles.groupId, groupId), eq(roles.name, 'Administrador'))).limit(1)
        // Grupo cujo cargo de administrador foi renomeado ou apagado: nada a
        // sincronizar, e o certo e nao inventar um cargo novo por conta propria.
        if (cargoAdmin === undefined) return

        if (novoPapel === 'admin') {
          await tx.insert(memberRoles)
            .values({ groupId, userId: alvo, roleId: cargoAdmin.id })
            .onConflictDoNothing()
        } else {
          await tx.delete(memberRoles).where(and(
            eq(memberRoles.groupId, groupId),
            eq(memberRoles.userId, alvo),
            eq(memberRoles.roleId, cargoAdmin.id),
          ))
        }
      })
    }

    const dados = { groupId, userId: alvo, role: novoPapel, joinedAt: atual.joinedAt }
    await emit.toGroup(groupId, { t: 'member.updated', d: dados })
    return dados
  })

  app.delete('/api/groups/:id/members/:userId', { preHandler: requireAuth }, async (req, reply) => {
    const p = req.params as { id: string; userId: string }
    const groupId = uuidOu404(p.id)
    const alvo = uuidOu404(p.userId)
    const eu = req.user!.id

    const actor = await loadGroupActor(eu, groupId)
    // Sair e direito de qualquer membro; expulsar exige group.kick. Um member
    // que nao pertence ao grupo cai no group.view e leva 404 igual.
    //
    // A hierarquia NAO entra aqui, e sim tres linhas abaixo. A ordem importa:
    // `assertCan` responde sempre 404, e deixar a altura barrar primeiro
    // transformaria "voce nao pode expulsar o dono" — que e um 409 claro, com
    // o caminho da transferencia na mensagem — num 404 que nao ensina nada a
    // quem tem todo o direito de estar ali.
    assertCan(actor, alvo === eu ? 'group.view' : 'group.kick', { kind: 'group' })

    const g = await carregarGrupo(groupId)
    await membroOu404(groupId, alvo)

    // Conversa se FECHA (`DELETE /api/dms/:id`), e nao se deixa: sair dela
    // apagaria a conversa da lista do outro tambem, por tabela.
    if (g.kind === 'dm') throw new AppError('dm_cannot_leave')

    // Vale para sair e para ser expulso: o dono nao e removivel. Transferir a
    // titularidade e o unico caminho.
    if (alvo === g.ownerId) throw new AppError('owner_cannot_leave')

    // Agora sim a altura, e so quando ha outra pessoa envolvida: sair e uma
    // acao sobre si mesmo, e comparar a propria altura com a propria recusaria
    // a saida de quem tem cargo.
    if (alvo !== eu) {
      assertCan(actor, 'group.kick', {
        kind: 'group', topoDoAlvo: await alturaDe(alvo, groupId),
      })
    }

    // Antes da remocao, para que quem saiu tambem receba o aviso e limpe o
    // grupo da propria barra lateral sem precisar recarregar.
    const audiencia = await audienceOfGroup(groupId)

    await db.transaction(async tx => {
      await tx.delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, alvo)))

      // Explicito, e nao por cascata: channel_members referencia channels e
      // users, jamais group_members. Sem este DELETE, quem sai do grupo
      // continuaria em channel_members dos canais privados dele — e voltaria a
      // ler tudo se fosse readmitido. Spec 03 secao 9.
      const doGrupo = tx.select({ id: channels.id }).from(channels)
        .where(eq(channels.groupId, groupId))
      await tx.delete(channelMembers).where(and(
        eq(channelMembers.userId, alvo),
        inArray(channelMembers.channelId, doGrupo),
      ))
    })

    emit.toUsers(audiencia, { t: 'member.left', d: { groupId, userId: alvo } })
    return reply.status(204).send()
  })
}

export { contarMembros, parse, uuidOu404 }
