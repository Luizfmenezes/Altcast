import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import { users } from '../src/db/schema.js'
import {
  INTERVALO_DE_TROCA_MS, RESERVADOS, normalizarUsername, problemaNoUsername,
} from '../src/auth/username.js'

/**
 * O handle unico.
 *
 * A tabela abaixo e exaustiva de proposito: a funcao e pura e sem banco, entao
 * cobrir todos os ramos custa nada e e o que sustenta o limiar de 95% de
 * `auth/**` sem inflar os testes de integracao.
 */

describe('as regras do nome de usuario', () => {
  const bons = ['felipe', 'ana.silva', 'jo_ao', 'a1b', 'x'.repeat(32), 'time2026']
  for (const v of bons) {
    it(`aceita "${v}"`, () => { expect(problemaNoUsername(v)).toBeNull() })
  }

  const maus: [string, RegExp][] = [
    ['ab', /3 caracteres/],
    ['x'.repeat(33), /32 caracteres/],
    ['Com Espaco', /letras minusculas/],
    ['acento-ç', /letras minusculas/],
    ['com-hifen', /letras minusculas/],
    ['.comeca', /comecar/],
    ['_comeca', /comecar/],
    ['termina.', /terminar/],
    ['termina_', /terminar/],
    ['dois..pontos', /dois pontos/],
    ['12345', /so numeros/],
    ['admin', /reservado/],
    // A metade nao obvia da lista de reservados: se um dia existir `/@handle`,
    // um handle chamado `groups` colidiria com uma rota de verdade.
    ['groups', /reservado/],
    ['avatars', /reservado/],
    ['api', /reservado/],
  ]
  for (const [v, esperado] of maus) {
    it(`recusa "${v}"`, () => { expect(problemaNoUsername(v)).toMatch(esperado) })
  }

  it('normaliza caixa e espaco em volta', () => {
    expect(normalizarUsername('  Felipe  ')).toBe('felipe')
  })

  it('a lista de reservados cobre os segmentos que a API serve', () => {
    for (const rota of ['api', 'auth', 'groups', 'channels', 'invites', 'avatars', 'icons', 'ws']) {
      expect(RESERVADOS.has(rota)).toBe(true)
    }
  })
})

describe('reivindicar um nome de usuario', () => {
  it('a primeira escolha vale', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'felipe@x.com')

      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'Felipe' },
      })
      expect(r.statusCode).toBe(200)
      // Guardado ja normalizado: o handle e um so, em qualquer caixa.
      expect(r.json().user.username).toBe('felipe')
      await app.close()
    })
  })

  it('outra pessoa nao leva o mesmo, nem mudando a caixa', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const a = await loginComo(app, db, 'a@x.com')
      const b = await loginComo(app, db, 'b@x.com')

      await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: a.cookie }, payload: { username: 'felipe' },
      })
      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: b.cookie }, payload: { username: 'FELIPE' },
      })

      expect(r.statusCode).toBe(409)
      expect(r.json().error.code).toBe('username_taken')
      await app.close()
    })
  })

  /**
   * A unicidade vem do INDICE.
   *
   * Um `SELECT` seguido de `UPDATE` leria "livre" nos dois pedidos e o segundo
   * sobrescreveria o primeiro. Para ver este teste vermelho, troque o
   * tratamento de `23505` por uma checagem antecipada.
   */
  it('dois pedidos simultaneos pelo mesmo handle: so um vence', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const a = await loginComo(app, db, 'a@x.com')
      const b = await loginComo(app, db, 'b@x.com')

      const pedir = (cookie: string) => app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie }, payload: { username: 'disputado' },
      })

      const [ra, rb] = await Promise.all([pedir(a.cookie), pedir(b.cookie)])
      expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409])
      await app.close()
    })
  })

  it('formato invalido diz o que corrigir', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'com espaco' },
      })
      expect(r.statusCode).toBe(422)
      expect(r.json().error.details.username[0]).toMatch(/letras minusculas/)
      await app.close()
    })
  })

  it('trocar de novo no mesmo mes e recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'primeiro' },
      })
      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'segundo' },
      })
      expect(r.statusCode).toBe(409)
      expect(r.json().error.code).toBe('username_change_too_soon')
      await app.close()
    })
  })

  it('pedir o handle que ja se tem nao gasta a cota do mes', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'felipe' },
      })
      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'felipe' },
      })
      expect(r.statusCode).toBe(200)
      await app.close()
    })
  })

  it('passado o intervalo, a troca vale', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'antigo' },
      })
      await db.update(users)
        .set({ usernameChangedAt: new Date(Date.now() - INTERVALO_DE_TROCA_MS - 1000) })
        .where(eq(users.id, eu.userId))

      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: eu.cookie }, payload: { username: 'novo' },
      })
      expect(r.statusCode).toBe(200)
      await app.close()
    })
  })
})

describe('encontrar alguem pelo handle', () => {
  it('devolve o essencial, e nunca o e-mail', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const alvo = await loginComo(app, db, 'alvo@x.com')
      const eu = await loginComo(app, db, 'eu@x.com')

      await app.inject({
        method: 'PATCH', url: '/api/auth/me/username',
        headers: { cookie: alvo.cookie }, payload: { username: 'procurada' },
      })

      const r = await app.inject({
        method: 'GET', url: '/api/users/lookup?username=Procurada',
        headers: { cookie: eu.cookie },
      })
      expect(r.statusCode).toBe(200)
      const corpo = r.json()
      expect(corpo.userId).toBe(alvo.userId)
      // O e-mail nao pode sair daqui: isto seria um tradutor de handle para
      // endereco, aberto a qualquer conta.
      expect(corpo.email).toBeUndefined()
      await app.close()
    })
  })

  it('handle inexistente e 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')
      const r = await app.inject({
        method: 'GET', url: '/api/users/lookup?username=ninguem',
        headers: { cookie: eu.cookie },
      })
      expect(r.statusCode).toBe(404)
      await app.close()
    })
  })

  it('sem sessao, nao responde', async () => {
    await withTestDb(async () => {
      const app = await buildServer()
      const r = await app.inject({ method: 'GET', url: '/api/users/lookup?username=x' })
      expect(r.statusCode).toBe(401)
      await app.close()
    })
  })
})
