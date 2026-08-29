import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { users, groups, groupMembers } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'

describe('schema', () => {
  it('impede dois owners no mesmo grupo', async () => {
    await withTestDb(async db => {
      const u1 = newId(), u2 = newId(), g = newId()
      await db.insert(users).values([
        { id: u1, email: 'a@x.com', passwordHash: 'h', displayName: 'A' },
        { id: u2, email: 'b@x.com', passwordHash: 'h', displayName: 'B' },
      ])
      await db.insert(groups).values({ id: g, name: 'Time', ownerId: u1 })
      await db.insert(groupMembers).values({ groupId: g, userId: u1, role: 'owner' })

      await expect(
        db.insert(groupMembers).values({ groupId: g, userId: u2, role: 'owner' })
      ).rejects.toThrow()
    })
  })

  it('trata e-mail como case-insensitive', async () => {
    await withTestDb(async db => {
      await db.insert(users).values({ id: newId(), email: 'Felipe@X.com', passwordHash: 'h', displayName: 'F' })
      await expect(
        db.insert(users).values({ id: newId(), email: 'felipe@x.com', passwordHash: 'h', displayName: 'F2' })
      ).rejects.toThrow()
    })
  })
})
