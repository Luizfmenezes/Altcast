import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import type { Armazem } from '../src/media/armazenamento.js'
import { LADO_DO_AVATAR, LADO_DO_ICONE } from '../src/media/imagem.js'

/**
 * Avatar e icone com bytes nossos por tras.
 *
 * O caso que mais importa aqui nao e o feliz: e o `GET /api/icons/:id` SEM
 * cookie devolvendo 200. Essa rota e deliberadamente aberta, porque a previa
 * publica de convite precisa do icone, e um `requireAuth` bem-intencionado
 * acrescentado no futuro quebraria a tela de entrada sem quebrar teste nenhum
 * — a menos que este exista.
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

/** PNG real: o sharp le os bytes de verdade e recusa um placeholder. */
async function png(lado: number): Promise<Buffer> {
  return sharp({
    create: { width: lado, height: lado, channels: 3, background: { r: 20, g: 80, b: 200 } },
  }).png().toBuffer()
}

function multipart(nome: string, dados: Buffer): {
  payload: Buffer; headers: Record<string, string>
} {
  const limite = '----altcastteste'
  const cabeca = Buffer.from(
    `--${limite}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${nome}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n',
  )
  const pe = Buffer.from(`\r\n--${limite}--\r\n`)
  return {
    payload: Buffer.concat([cabeca, dados, pe]),
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  }
}

describe('avatar', () => {
  it('sobe, vira webp quadrado e ganha uma URL propria', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const eu = await loginComo(app, db, 'eu@x.com')

      // Retangular de proposito: o recorte precisa devolver um quadrado.
      const original = await sharp({
        create: { width: 800, height: 400, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).png().toBuffer()

      const { payload, headers } = multipart('eu.png', original)
      const r = await app.inject({
        method: 'POST', url: '/api/auth/me/avatar',
        headers: { ...headers, cookie: eu.cookie }, payload,
      })

      expect(r.statusCode).toBe(201)
      expect(r.json().avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}$/)

      const guardado = [...armazem.objetos.values()][0]!
      const meta = await sharp(guardado.dados).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(LADO_DO_AVATAR)
      expect(meta.height).toBe(LADO_DO_AVATAR)
      await app.close()
    })
  })

  it('a URL serve a imagem como imutavel', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const eu = await loginComo(app, db, 'eu@x.com')

      const { payload, headers } = multipart('eu.png', await png(64))
      const subida = await app.inject({
        method: 'POST', url: '/api/auth/me/avatar',
        headers: { ...headers, cookie: eu.cookie }, payload,
      })

      const r = await app.inject({ method: 'GET', url: subida.json().avatarUrl })
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toBe('image/webp')
      expect(r.headers['cache-control']).toContain('immutable')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      await app.close()
    })
  })

  it('trocar a foto apaga a anterior', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const eu = await loginComo(app, db, 'eu@x.com')

      const subir = async () => {
        const { payload, headers } = multipart('eu.png', await png(64))
        return app.inject({
          method: 'POST', url: '/api/auth/me/avatar',
          headers: { ...headers, cookie: eu.cookie }, payload,
        })
      }

      const primeira = await subir()
      const segunda = await subir()

      expect(primeira.json().avatarUrl).not.toBe(segunda.json().avatarUrl)
      expect(armazem.removidos).toHaveLength(1)
      expect(armazem.objetos.size).toBe(1)
      await app.close()
    })
  })

  /**
   * O tipo sai dos BYTES. O que o cliente declarou no multipart nao participa
   * da decisao — mesma regra do anexo, pelo mesmo motivo.
   */
  it('um executavel chamado foto.png e recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const eu = await loginComo(app, db, 'eu@x.com')

      const executavel = Buffer.from('MZ\x90\x00\x03\x00\x00\x00programa', 'binary')
      const { payload, headers } = multipart('foto.png', executavel)
      const r = await app.inject({
        method: 'POST', url: '/api/auth/me/avatar',
        headers: { ...headers, cookie: eu.cookie }, payload,
      })

      expect(r.statusCode).toBe(422)
      expect(r.json().error.code).toBe('unsupported_image')
      await app.close()
    })
  })

  it('sem armazenamento configurado, diz isso em vez de "algo deu errado"', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: null })
      const eu = await loginComo(app, db, 'eu@x.com')

      const { payload, headers } = multipart('eu.png', await png(64))
      const r = await app.inject({
        method: 'POST', url: '/api/auth/me/avatar',
        headers: { ...headers, cookie: eu.cookie }, payload,
      })

      expect(r.statusCode).toBe(503)
      expect(r.json().error.code).toBe('storage_unavailable')
      await app.close()
    })
  })
})

describe('icone do grupo', () => {
  it('quem administra o grupo troca o icone', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const base = await cenarioComAdmin(app, db)

      const { payload, headers } = multipart('icone.png', await png(128))
      const r = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/icon`,
        headers: { ...headers, cookie: base.cookieDono }, payload,
      })

      expect(r.statusCode).toBe(201)
      expect(r.json().iconUrl).toMatch(/^\/api\/icons\//)

      const guardado = [...armazem.objetos.values()][0]!
      const meta = await sharp(guardado.dados).metadata()
      expect(meta.width).toBe(LADO_DO_ICONE)
      await app.close()
    })
  })

  it('membro comum nem enxerga a acao: 404, nao 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const forasteiro = await loginComo(app, db, 'fora@x.com')

      const { payload, headers } = multipart('icone.png', await png(64))
      const r = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/icon`,
        headers: { ...headers, cookie: forasteiro.cookie }, payload,
      })

      expect(r.statusCode).toBe(404)
      await app.close()
    })
  })

  /**
   * ESTE e o teste que protege a decisao de projeto.
   *
   * `GET /api/invites/:code` e a unica rota nao autenticada que devolve dado
   * de grupo, e ela devolve o `groupIconUrl`. Se alguem puser `requireAuth`
   * aqui achando que esta apertando a seguranca, a previa de convite passa a
   * mostrar um icone quebrado para todo visitante — e ninguem descobriria sem
   * este caso.
   */
  it('o icone e servido SEM cookie, porque a previa de convite precisa dele', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)

      const { payload, headers } = multipart('icone.png', await png(64))
      const subida = await app.inject({
        method: 'POST', url: `/api/groups/${base.groupId}/icon`,
        headers: { ...headers, cookie: base.cookieDono }, payload,
      })

      const r = await app.inject({ method: 'GET', url: subida.json().iconUrl })
      expect(r.statusCode).toBe(200)
      await app.close()
    })
  })

  it('id que nao existe e 404, e id malformado tambem', async () => {
    await withTestDb(async () => {
      const app = await buildServer({ armazem: new ArmazemFalso() })

      const inexistente = await app.inject({
        method: 'GET', url: '/api/icons/01940000-0000-7000-8000-000000000000',
      })
      expect(inexistente.statusCode).toBe(404)

      const malformado = await app.inject({ method: 'GET', url: '/api/icons/nao-e-uuid' })
      expect(malformado.statusCode).toBe(404)
      await app.close()
    })
  })
})
