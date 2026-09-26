import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { comServidor } from './helpers/ws.js'
import { channelOverwrites, groupMembers, roles } from '../src/db/schema.js'
import { loadChannelActor, loadGroupActor } from '../src/permissions/context.js'
import { can } from '../src/permissions/can.js'

/**
 * Os casos que so os CARGOS trazem.
 *
 * A matriz de `can.test.ts` continua sendo a prova de que nada do
 * comportamento antigo mudou; aqui ficam as regras que nao existiam antes:
 * uniao de conjuntos, hierarquia, excecao de canal e a trava que impede
 * escalar privilegio.
 */

async function cargoAdmin(db: Parameters<Parameters<typeof withTestDb>[0]>[0], groupId: string) {
  const [r] = await db.select().from(roles)
    .where(and(eq(roles.groupId, groupId), eq(roles.name, 'Administrador'))).limit(1)
  return r!
}

describe('cargos', () => {
  it('grupo nasce com o cargo de todos e o de administrador', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const res = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono },
        })
        expect(res.statusCode).toBe(200)
        const lista = res.json() as { name: string; isDefault: boolean; position: number }[]
        // Ordenados por posicao descendente: o mais alto primeiro, que e a
        // ordem em que a tela os desenha.
        expect(lista.map(r => r.name)).toEqual(['Administrador', 'todos'])
        expect(lista.find(r => r.isDefault)!.name).toBe('todos')
      })
    })
  })

  it('soma as permissoes de todos os cargos da pessoa', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        // Antes do cargo: o conjunto do `todos`, que nao apaga mensagem alheia.
        const antes = await loadGroupActor(ze.userId, base.groupId)
        expect(can(antes, 'message.delete_any', { kind: 'message', authorId: 'outro' })).toBe(false)

        const cargo = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'Moderador', color: '#ff0000', permissions: ['message.delete_any'] },
        })
        expect(cargo.statusCode).toBe(201)

        await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { roleIds: [cargo.json().id] },
        })

        // Depois: a UNIAO do `todos` com o `Moderador`. Nem so um, nem so o
        // outro — ganhar um cargo nunca pode tirar o que ja se podia.
        const depois = await loadGroupActor(ze.userId, base.groupId)
        expect(can(depois, 'message.delete_any', { kind: 'message', authorId: 'outro' })).toBe(true)
        expect(can(depois, 'channel.write', { kind: 'channel', visibility: 'public' })).toBe(true)
        // E nada alem: moderar nao virou administrar.
        expect(can(depois, 'channel.delete', { kind: 'channel' })).toBe(false)
      })
    })
  })

  it('ninguem concede uma permissao que nao tem', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        // O admin recebe o poder de gerenciar cargos, e SO ele. Apagar o grupo
        // continua fora do conjunto dele.
        const admin = await cargoAdmin(db, base.groupId)
        await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${admin.id}`,
          headers: { cookie: base.cookieDono },
          payload: { permissions: [...admin.permissions, 'group.manage_roles'] },
        })

        const tentativa = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieAdmin },
          payload: { name: 'Deus', permissions: ['group.delete'] },
        })
        // Sem esta trava, "gerenciar cargos" seria um atalho para TODAS as
        // outras permissoes, e a tela de permissoes viraria decoracao.
        expect(tentativa.statusCode).toBe(409)
        expect(tentativa.json().error.code).toBe('cannot_grant_unheld')

        // O dono passa: ele atravessa a concessao, e e a saida que impede um
        // grupo de ficar trancado por configuracao.
        const doDono = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'Deus', permissions: ['group.delete'] },
        })
        expect(doDono.statusCode).toBe(201)
      })
    })
  })

  it('so se mexe em cargo abaixo do seu', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const admin = await cargoAdmin(db, base.groupId)
        await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${admin.id}`,
          headers: { cookie: base.cookieDono },
          payload: { permissions: [...admin.permissions, 'group.manage_roles'] },
        })

        // O proprio cargo, na propria altura: nao se edita. Sem isto, a
        // primeira coisa que alguem faz e se promover.
        const proprio = await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${admin.id}`,
          headers: { cookie: base.cookieAdmin }, payload: { name: 'Supremo' },
        })
        expect(proprio.statusCode).toBe(409)
        expect(proprio.json().error.code).toBe('role_above_you')

        // Apagar tambem nao.
        const apagar = await app.inject({
          method: 'DELETE', url: `/api/groups/${base.groupId}/roles/${admin.id}`,
          headers: { cookie: base.cookieAdmin },
        })
        expect(apagar.statusCode).toBe(409)
      })
    })
  })

  it('o cargo de todos nao se renomeia nem se apaga, mas se edita', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const [padrao] = await db.select().from(roles)
          .where(and(eq(roles.groupId, base.groupId), eq(roles.isDefault, true))).limit(1)

        const renomear = await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${padrao!.id}`,
          headers: { cookie: base.cookieDono }, payload: { name: 'geral' },
        })
        expect(renomear.statusCode).toBe(409)
        expect(renomear.json().error.code).toBe('default_role_locked')

        const apagar = await app.inject({
          method: 'DELETE', url: `/api/groups/${base.groupId}/roles/${padrao!.id}`,
          headers: { cookie: base.cookieDono },
        })
        expect(apagar.statusCode).toBe(409)

        // As PERMISSOES dele sao editaveis — e para isso que ele existe. Aqui
        // o grupo inteiro perde o direito de anexar arquivo.
        const editar = await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${padrao!.id}`,
          headers: { cookie: base.cookieDono },
          payload: { permissions: ['channel.read'] },
        })
        expect(editar.statusCode).toBe(200)

        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })
        const ator = await loadGroupActor(ze.userId, base.groupId)
        expect(can(ator, 'channel.read', { kind: 'channel', visibility: 'public' })).toBe(true)
        expect(can(ator, 'message.attach', { kind: 'channel', visibility: 'public' })).toBe(false)
      })
    })
  })

  it('cargo nenhum enxerga canal privado do qual a pessoa nao participa', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const privado = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'segredo', visibility: 'private' },
        })
        const canalId = privado.json().id as string

        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        // Um cargo com TUDO marcado. O teto da permissao nao e o teto do
        // segredo: `channel_members` continua sendo a unica porta, e e por
        // isso que nenhum cargo pode ser desenhado como "ver todos os canais".
        const todoPoder = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono },
          payload: {
            name: 'Onisciente',
            permissions: ['channel.read', 'channel.write', 'attachment.read', 'channel.join_call'],
          },
        })
        await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { roleIds: [todoPoder.json().id] },
        })

        const { actor } = (await loadChannelActor(ze.userId, canalId))!
        expect(actor.inChannel).toBe(false)
        expect(can(actor, 'channel.read', { kind: 'channel', visibility: 'private' })).toBe(false)
        expect(can(actor, 'channel.join_call', { kind: 'channel', visibility: 'private' })).toBe(false)
      })
    })
  })

  it('excecao de canal nega, e a da pessoa vence a do cargo', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const canais = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
        })
        const canalId = canais.json()[0].id as string

        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        const [padrao] = await db.select().from(roles)
          .where(and(eq(roles.groupId, base.groupId), eq(roles.isDefault, true))).limit(1)

        // O cargo de todos perde escrever NESTE canal.
        await db.insert(channelOverwrites).values({
          channelId: canalId, subjectType: 'role', subjectId: padrao!.id,
          allow: [], deny: ['channel.write'],
        })
        const negado = (await loadChannelActor(ze.userId, canalId))!.actor
        expect(can(negado, 'channel.write', { kind: 'channel', visibility: 'public' })).toBe(false)

        // E uma excecao dirigida a ELE devolve. Do mais geral para o mais
        // especifico: e a unica ordem que as pessoas conseguem prever.
        await db.insert(channelOverwrites).values({
          channelId: canalId, subjectType: 'user', subjectId: ze.userId,
          allow: ['channel.write'], deny: [],
        })
        const devolvido = (await loadChannelActor(ze.userId, canalId))!.actor
        expect(can(devolvido, 'channel.write', { kind: 'channel', visibility: 'public' })).toBe(true)
      })
    })
  })

  it('nao se edita os cargos de quem esta acima de voce', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const admin = await cargoAdmin(db, base.groupId)
        await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/roles/${admin.id}`,
          headers: { cookie: base.cookieDono },
          payload: { permissions: [...admin.permissions, 'group.change_role'] },
        })

        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        const alto = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { name: 'Diretoria' },
        })
        const baixo = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { name: 'Estagio' },
        })
        await db.update(roles).set({ position: 50 }).where(eq(roles.id, alto.json().id))
        await db.update(roles).set({ position: 1 }).where(eq(roles.id, baixo.json().id))

        // Ze passa a estar ACIMA do admin (50 contra 10).
        await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { roleIds: [alto.json().id] },
        })

        // E entao o admin nao mexe nela de jeito nenhum. A hierarquia vale no
        // nivel da PESSOA, antes de chegar a discussao de qual cargo: e o que
        // impede um moderador de rebaixar quem o nomeou.
        const barrado = await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieAdmin }, payload: { roleIds: [baixo.json().id] },
        })
        expect(barrado.statusCode).toBe(404)

        // Com a Ze de volta para baixo, o mesmo pedido passa.
        await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { roleIds: [] },
        })
        const liberado = await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieAdmin }, payload: { roleIds: [baixo.json().id] },
        })
        expect(liberado.statusCode).toBe(200)
        expect(liberado.json().roleIds).toEqual([baixo.json().id])
      })
    })
  })

  it('promover a admin concede o cargo de administrador', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/members/${ze.userId}`,
          headers: { cookie: base.cookieDono }, payload: { role: 'admin' },
        })

        // O rotulo e o poder precisam andar juntos: trocar so a coluna faria a
        // lista de membros dizer "Administrador" para quem nao pode nada.
        const ator = await loadGroupActor(ze.userId, base.groupId)
        expect(ator.papel).toBe('admin')
        expect(can(ator, 'channel.create', { kind: 'group' })).toBe(true)

        await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}/members/${ze.userId}`,
          headers: { cookie: base.cookieDono }, payload: { role: 'member' },
        })
        const rebaixado = await loadGroupActor(ze.userId, base.groupId)
        expect(can(rebaixado, 'channel.create', { kind: 'group' })).toBe(false)
      })
    })
  })

  it('sair do grupo leva os cargos junto', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const ze = await loginComo(app, db, 'ze@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })

        const cargo = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/roles`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'Moderador', permissions: ['message.delete_any'] },
        })
        await app.inject({
          method: 'PUT', url: `/api/groups/${base.groupId}/members/${ze.userId}/roles`,
          headers: { cookie: base.cookieDono }, payload: { roleIds: [cargo.json().id] },
        })

        await app.inject({
          method: 'DELETE', url: `/api/groups/${base.groupId}/members/${ze.userId}`,
          headers: { cookie: ze.cookie },
        })

        // A chave estrangeira composta aponta para group_members: sem ela, uma
        // linha orfa devolveria a moderacao no dia em que a pessoa voltasse.
        const sobrou = await db.select().from(roles)
        expect(sobrou.length).toBeGreaterThan(0)
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: ze.userId, role: 'member' })
        const devolta = await loadGroupActor(ze.userId, base.groupId)
        expect(can(devolta, 'message.delete_any', { kind: 'message', authorId: 'x' })).toBe(false)
      })
    })
  })
})
