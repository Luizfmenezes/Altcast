import { eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioPrivado, criarUsuario } from './helpers/fixtures.js'
import { groupMembers, groups } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { audienceOfChannel, audienceOfGroup, audienceOfUser } from '../src/realtime/fanout.js'

describe('fanout', () => {
  it('canal publico: todos os membros do grupo', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      expect((await audienceOfChannel(c.canalPublico)).sort())
        .toEqual([c.owner, c.admin, c.membroDentro, c.membroFora].sort())
    })
  })

  it('canal privado: apenas a lista de acesso', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      const audiencia = await audienceOfChannel(c.canal)

      expect(audiencia).toContain(c.membroDentro)
      expect(audiencia).not.toContain(c.membroFora)
      // As duas linhas abaixo sao a regra do eixo duplo em forma executavel:
      // administrar nao da acesso de leitura, portanto nao da evento.
      expect(audiencia).not.toContain(c.admin)
      expect(audiencia).not.toContain(c.owner)
    })
  })

  it('quem saiu do grupo desaparece da audiencia', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      await db.delete(groupMembers).where(eq(groupMembers.userId, c.membroFora))

      expect(await audienceOfChannel(c.canalPublico)).not.toContain(c.membroFora)
      expect(await audienceOfGroup(c.grupo)).not.toContain(c.membroFora)
    })
  })

  it('audiencia de usuario cobre todos os grupos em comum, sem repetir', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)

      // Segundo grupo compartilhado com o admin: ele nao pode aparecer duas
      // vezes so por dividir dois grupos com o owner.
      const outro = newId()
      await db.insert(groups).values({ id: outro, name: 'Outro', ownerId: c.owner })
      await db.insert(groupMembers).values([
        { groupId: outro, userId: c.owner, role: 'owner' },
        { groupId: outro, userId: c.admin, role: 'member' },
      ])

      const audiencia = await audienceOfUser(c.owner)
      expect(audiencia.filter(id => id === c.admin)).toHaveLength(1)
      expect(audiencia.sort()).toEqual([c.owner, c.admin, c.membroDentro, c.membroFora].sort())
      expect(audiencia).not.toContain(c.estranho)
    })
  })

  it('usuario sem grupo tem audiencia vazia', async () => {
    await withTestDb(async db => {
      const solitario = await criarUsuario(db, { email: 'so@x.com' })
      expect(await audienceOfUser(solitario)).toEqual([])
    })
  })

  it('canal inexistente devolve lista vazia, nunca lanca', async () => {
    await withTestDb(async () => {
      expect(await audienceOfChannel(newId())).toEqual([])
      expect(await audienceOfGroup(newId())).toEqual([])
    })
  })
})
