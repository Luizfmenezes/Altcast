import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/index.js'
import { AppError } from '../src/shared/errors.js'

describe('handler de erro', () => {
  it('serializa AppError no contrato da spec', async () => {
    const app = await buildServer()
    app.get('/boom', async () => { throw new AppError('invite_expired') })
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe('invite_expired')
    expect(res.json().error.requestId).toBeTruthy()
    await app.close()
  })

  it('nao vaza detalhe interno em erro inesperado', async () => {
    const app = await buildServer()
    app.get('/crash', async () => { throw new Error('senha do banco e hunter2') })
    const res = await app.inject({ method: 'GET', url: '/crash' })
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.json())).not.toContain('hunter2')
    expect(res.json().error.code).toBe('internal_error')
    await app.close()
  })
})
