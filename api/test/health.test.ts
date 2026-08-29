import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/index.js'

describe('GET /api/health', () => {
  it('responde 200 com status ok', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
    await app.close()
  })
})
