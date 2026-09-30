import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { withTestDb } from './helpers/db.js'
import { loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import { groupMembers } from '../src/db/schema.js'
import type { Armazem } from '../src/media/armazenamento.js'
import { BANNER } from '../src/media/imagem.js'

/**
 * O perfil personalizavel: "sobre mim", pronomes e banner.
 *
 * O que mais importa aqui e a fronteira de leitura: o perfil de alguem so
 * sai para quem divide um grupo com a pessoa, e fora disso a resposta e 404 —
 * nunca 403, que confirmaria que a conta existe.
 */

class ArmazemFalso implements Armazem {
  objetos = new Map<string, { dados: Buffer; contentType: string }>()
  removidos: string[] = []

  async guardar(chave: string, dados: Buffer, contentType: string): Promise<void> {
    this.objetos.set(chave, { dados, contentType })
  }

  async ler(chave: string): Promise<Readable> {
    const o = this.objetos.get(chave)
    if (o === undefined) throw new Error(`objeto inexistente: ${chave}`)
    return Readable.from(o.dados)
  }

  async remover(chaves: string[]): Promise<void> {
    this.removidos.push(...chaves)
    for (const c of chaves) this.objetos.delete(c)
  }
}

function multipart(dados: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const limite = '----altcastteste'
  const cabeca = Buffer.from(
    `--${limite}\r\n`
    + 'Content-Disposition: form-data; name="file"; filename="banner.png"\r\n'
    + 'Content-Type: application/octet-stream\r\n\r\n',
  )
  const pe = Buffer.from(`\r\n--${limite}--\r\n`)
  return {
    payload: Buffer.concat([cabeca, dados, pe]),
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  }
}

describe('editar o proprio perfil', () => {
  it('grava bio, pronomes e cor, e o /me devolve os tres', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: eu.cookie },
        payload: { bio: '  Toco baixo nas horas vagas.  ', pronouns: 'ele/dele', bannerColor: '#1E90FF' },
      })
      expect(r.statusCode).toBe(200)
      expect(r.json().user).toMatchObject({
        bio: 'Toco baixo nas horas vagas.', pronouns: 'ele/dele', bannerColor: '#1e90ff',
      })

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: eu.cookie } })
      expect(me.json().user.bio).toBe('Toco baixo nas horas vagas.')
      await app.close()
    })
  })

  it('texto vazio apaga, e nao grava uma bio em branco', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')
      await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: eu.cookie },
        payload: { bio: 'algo' },
      })

      const r = await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: eu.cookie },
        payload: { bio: '   ' },
      })
      expect(r.json().user.bio).toBeNull()
      await app.close()
    })
  })

  it('recusa bio longa demais e cor que nao e #rrggbb', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')

      const longa = await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: eu.cookie },
        payload: { bio: 'x'.repeat(191) },
      })
      expect(longa.statusCode).toBe(422)

      // A cor vai parar num `style` no navegador de todo mundo: nada alem de
      // `#rrggbb` pode passar.
      const cor = await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: eu.cookie },
        payload: { bannerColor: 'red;background:url(x)' },
      })
      expect(cor.statusCode).toBe(422)
      await app.close()
    })
  })
})

describe('ler o perfil de alguem', () => {
  it('quem divide um grupo le o perfil inteiro', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const dono = await loginComo(app, db, 'dono@x.com')
      const grupo = await app.inject({
        method: 'POST', url: '/api/groups', headers: { cookie: dono.cookie },
        payload: { name: 'Time' },
      })
      const groupId = grupo.json().id as string
      const colega = await loginComo(app, db, 'colega@x.com')
      await db.insert(groupMembers).values({ groupId, userId: colega.userId, role: 'member' })

      await app.inject({
        method: 'PATCH', url: '/api/auth/me', headers: { cookie: dono.cookie },
        payload: { bio: 'Dono do time', pronouns: 'ela/dela', bannerColor: '#aa3366' },
      })

      const r = await app.inject({
        method: 'GET', url: `/api/users/${dono.userId}/profile`,
        headers: { cookie: colega.cookie },
      })
      expect(r.statusCode).toBe(200)
      expect(r.json().profile).toMatchObject({
        userId: dono.userId, bio: 'Dono do time', pronouns: 'ela/dela', bannerColor: '#aa3366',
      })
      // O e-mail nunca sai por aqui.
      expect(r.json().profile.email).toBeUndefined()
      await app.close()
    })
  })

  it('sem grupo em comum e 404, igual a conta inexistente', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const a = await loginComo(app, db, 'a@x.com')
      const b = await loginComo(app, db, 'b@x.com')

      const estranho = await app.inject({
        method: 'GET', url: `/api/users/${b.userId}/profile`, headers: { cookie: a.cookie },
      })
      const inexistente = await app.inject({
        method: 'GET', url: '/api/users/00000000-0000-7000-8000-000000000000/profile',
        headers: { cookie: a.cookie },
      })
      expect(estranho.statusCode).toBe(404)
      expect(inexistente.statusCode).toBe(404)
      await app.close()
    })
  })

  it('o proprio perfil sempre se le', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')
      const r = await app.inject({
        method: 'GET', url: `/api/users/${eu.userId}/profile`, headers: { cookie: eu.cookie },
      })
      expect(r.statusCode).toBe(200)
      await app.close()
    })
  })

  it('sem sessao e 401', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const eu = await loginComo(app, db, 'eu@x.com')
      const r = await app.inject({ method: 'GET', url: `/api/users/${eu.userId}/profile` })
      expect(r.statusCode).toBe(401)
      await app.close()
    })
  })
})

describe('banner', () => {
  it('sobe em 5:2, serve como webp e troca apaga o anterior', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const eu = await loginComo(app, db, 'eu@x.com')

      const subir = async (): Promise<string> => {
        const original = await sharp({
          create: { width: 500, height: 500, channels: 3, background: { r: 10, g: 10, b: 10 } },
        }).png().toBuffer()
        const { payload, headers } = multipart(original)
        const r = await app.inject({
          method: 'POST', url: '/api/auth/me/banner',
          headers: { ...headers, cookie: eu.cookie }, payload,
        })
        expect(r.statusCode).toBe(201)
        return r.json().bannerUrl as string
      }

      const primeira = await subir()
      expect(primeira).toMatch(/^\/api\/banners\/[0-9a-f-]{36}$/)
      const guardado = [...armazem.objetos.values()][0]!
      const meta = await sharp(guardado.dados).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(BANNER.largura)
      expect(meta.height).toBe(BANNER.altura)

      const servida = await app.inject({ method: 'GET', url: primeira })
      expect(servida.statusCode).toBe(200)
      expect(servida.headers['content-type']).toBe('image/webp')

      await subir()
      expect(armazem.removidos).toHaveLength(1)

      const apagar = await app.inject({
        method: 'DELETE', url: '/api/auth/me/banner', headers: { cookie: eu.cookie },
      })
      expect(apagar.statusCode).toBe(204)
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: eu.cookie } })
      expect(me.json().user.bannerUrl).toBeNull()
      await app.close()
    })
  })
})
