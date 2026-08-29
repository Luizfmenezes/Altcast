import { describe, it, expect } from 'vitest'
import { parseEnv } from '../src/env.js'

describe('parseEnv', () => {
  it('aceita ambiente completo', () => {
    const e = parseEnv({
      NODE_ENV: 'test', PORT: '3000',
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      PUBLIC_URL: 'http://localhost:5173',
      SESSION_COOKIE_NAME: 'altcast_session',
      SESSION_TTL_DAYS: '30', LOG_LEVEL: 'info',
    })
    expect(e.PORT).toBe(3000)
    expect(e.ALLOWED_ORIGINS).toEqual(['http://localhost:5173'])
  })

  it('morre com mensagem clara quando falta DATABASE_URL', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/)
  })
})
