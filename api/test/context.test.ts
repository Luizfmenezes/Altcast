import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioPrivado } from './helpers/fixtures.js'
import { loadChannelActor, loadGroupActor, assertCan } from '../src/permissions/context.js'

describe('contexto de autorizacao', () => {
  it('marca inChannel corretamente em canal privado', async () => {
    await withTestDb(async db => {
      const { admin, membroDentro, membroFora, canal } = await cenarioPrivado(db)

      expect((await loadChannelActor(membroDentro, canal))!.actor.inChannel).toBe(true)
      expect((await loadChannelActor(membroFora, canal))!.actor.inChannel).toBe(false)
      // O admin esta fora do canal: administrar nao concede leitura.
      expect((await loadChannelActor(admin, canal))!.actor.inChannel).toBe(false)
    })
  })

  it('carrega o papel do grupo', async () => {
    await withTestDb(async db => {
      const { owner, admin, membroFora, estranho, grupo } = await cenarioPrivado(db)
      expect((await loadGroupActor(owner, grupo)).role).toBe('owner')
      expect((await loadGroupActor(admin, grupo)).role).toBe('admin')
      expect((await loadGroupActor(membroFora, grupo)).role).toBe('member')
      expect((await loadGroupActor(estranho, grupo)).role).toBeNull()
    })
  })

  it('devolve null para canal inexistente', async () => {
    await withTestDb(async db => {
      const { owner } = await cenarioPrivado(db)
      expect(await loadChannelActor(owner, '00000000-0000-7000-8000-000000000000')).toBeNull()
    })
  })

  it('assertCan lanca not_found, nunca forbidden', async () => {
    await withTestDb(async db => {
      const { membroFora, canal } = await cenarioPrivado(db)
      const ctx = (await loadChannelActor(membroFora, canal))!
      expect(() => assertCan(ctx.actor, 'channel.read', { kind: 'channel', visibility: 'private' }))
        .toThrowError(expect.objectContaining({ code: 'not_found' }))
    })
  })

  it('assertCan nao lanca quando permitido', async () => {
    await withTestDb(async db => {
      const { membroDentro, canal } = await cenarioPrivado(db)
      const ctx = (await loadChannelActor(membroDentro, canal))!
      expect(() => assertCan(ctx.actor, 'channel.read', { kind: 'channel', visibility: 'private' }))
        .not.toThrow()
    })
  })
})
