import { describe, it, expect } from 'vitest'
import { newId } from '../src/shared/ids.js'

describe('newId', () => {
  it('gera UUID versao 7', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('gera IDs crescentes ao longo do tempo', async () => {
    const a = newId()
    await new Promise(r => setTimeout(r, 2))
    expect(newId() > a).toBe(true)
  })
})
