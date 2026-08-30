import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import { correioDeRegistro } from '../src/email/registro.js'

const SENHA = 'uma frase longa que so eu sei'

/** O link do e-mail traz o token no ultimo segmento da URL. */
function tokenDoTexto(texto: string): string {
  const achado = /https?:\/\/\S+\/(?:verificar|redefinir)\/([A-Za-z0-9_-]+)/.exec(texto)
  if (!achado?.[1]) throw new Error(`nenhum token no e-mail:\n${texto}`)
  return achado[1]
}

describe('cadastro aberto', () => {
  it('cria conta sem codigo de convite e ja entra', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
      })

      expect(res.statusCode).toBe(201)
      expect(res.headers['set-cookie']).toContain('HttpOnly')
      // Nasce sem confirmar: entra na hora, e o e-mail vem depois.
      expect(res.json().user.emailVerifiedAt).toBeNull()
      await app.close()
    })
  })

  it('manda o e-mail de confirmacao no cadastro', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
      })

      expect(correio.enviadas).toHaveLength(1)
      expect(correio.enviadas[0]!.para).toBe('nova@x.com')
      expect(tokenDoTexto(correio.enviadas[0]!.texto)).toBeTruthy()
      await app.close()
    })
  })

  it('continua aceitando o codigo de convite, e ai a conta ja nasce no grupo', async () => {
    await withTestDb(async db => {
      // Confirmado por padrao no fixture: representa quem ja usava o sistema.
      await criarUsuario(db, { email: 'dono@x.com', senha: SENHA })

      const app = await buildServer({ correio: correioDeRegistro() })
      const entrada = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'dono@x.com', password: SENHA },
      })
      const cookie = entrada.headers['set-cookie'] as string

      const grupo = await app.inject({
        method: 'POST', url: '/api/groups', headers: { cookie },
        payload: { name: 'Anticorp' },
      })
      const convite = await app.inject({
        method: 'POST', url: `/api/groups/${grupo.json().id}/invites`,
        headers: { cookie }, payload: {},
      })

      const res = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: {
          email: 'convidada@x.com', password: SENHA, displayName: 'Convidada',
          inviteCode: convite.json().code,
        },
      })

      expect(res.statusCode).toBe(201)
      const me = await app.inject({
        method: 'GET', url: '/api/auth/me',
        headers: { cookie: res.headers['set-cookie'] as string },
      })
      expect(me.json().groups).toHaveLength(1)
      await app.close()
    })
  })

  it('e-mail ja cadastrado continua recusado', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const app = await buildServer({ correio: correioDeRegistro() })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'f@x.com', password: SENHA, displayName: 'Outra' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('email_taken')
      await app.close()
    })
  })

  it('senha fraca continua recusada', async () => {
    await withTestDb(async () => {
      const app = await buildServer({ correio: correioDeRegistro() })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'x@x.com', password: 'curta', displayName: 'Alguem' },
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })
})

describe('confirmacao de e-mail', () => {
  async function cadastrar(
    app: Awaited<ReturnType<typeof buildServer>>,
    correio: ReturnType<typeof correioDeRegistro>,
  ): Promise<{ cookie: string; token: string }> {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
    })
    return {
      cookie: res.headers['set-cookie'] as string,
      token: tokenDoTexto(correio.enviadas.at(-1)!.texto),
    }
  }

  it('o link confirma o endereco', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const { cookie, token } = await cadastrar(app, correio)

      const res = await app.inject({
        method: 'POST', url: '/api/auth/verify-email', payload: { token },
      })
      expect(res.statusCode).toBe(204)

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
      expect(me.json().user.emailVerifiedAt).not.toBeNull()
      await app.close()
    })
  })

  it('confirma sem precisar de sessao: o link e clicado em qualquer aparelho', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const { token } = await cadastrar(app, correio)
      // Sem cookie nenhum.
      const res = await app.inject({
        method: 'POST', url: '/api/auth/verify-email', payload: { token },
      })
      expect(res.statusCode).toBe(204)
      await app.close()
    })
  })

  it('o mesmo link nao serve duas vezes', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const { token } = await cadastrar(app, correio)

      await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } })
      const segunda = await app.inject({
        method: 'POST', url: '/api/auth/verify-email', payload: { token },
      })
      expect(segunda.statusCode).toBe(400)
      await app.close()
    })
  })

  it('token inventado e recusado', async () => {
    await withTestDb(async () => {
      const app = await buildServer({ correio: correioDeRegistro() })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/verify-email',
        payload: { token: 'a'.repeat(43) },
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })
  })

  it('pedir de novo invalida o link anterior', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const { cookie, token: primeiro } = await cadastrar(app, correio)

      await app.inject({
        method: 'POST', url: '/api/auth/resend-verification', headers: { cookie },
      })
      const segundo = tokenDoTexto(correio.enviadas.at(-1)!.texto)
      expect(segundo).not.toBe(primeiro)

      const velho = await app.inject({
        method: 'POST', url: '/api/auth/verify-email', payload: { token: primeiro },
      })
      expect(velho.statusCode).toBe(400)

      const novo = await app.inject({
        method: 'POST', url: '/api/auth/verify-email', payload: { token: segundo },
      })
      expect(novo.statusCode).toBe(204)
      await app.close()
    })
  })
})

describe('o que a conta nao confirmada nao pode', () => {
  it('nao cria grupo', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const cadastro = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
      })
      const res = await app.inject({
        method: 'POST', url: '/api/groups',
        headers: { cookie: cadastro.headers['set-cookie'] as string },
        payload: { name: 'Spam Inc' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('email_not_verified')
      await app.close()
    })
  })

  // Ler e escrever ficam livres de proposito: exigir confirmacao para
  // conversar transformaria o cadastro aberto numa promessa vazia.
  it('mas continua entrando e vendo a propria conta', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const cadastro = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
      })
      const me = await app.inject({
        method: 'GET', url: '/api/auth/me',
        headers: { cookie: cadastro.headers['set-cookie'] as string },
      })
      expect(me.statusCode).toBe(200)
      await app.close()
    })
  })

  it('depois de confirmar, cria grupo normalmente', async () => {
    await withTestDb(async () => {
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const cadastro = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { email: 'nova@x.com', password: SENHA, displayName: 'Pessoa Nova' },
      })
      const cookie = cadastro.headers['set-cookie'] as string
      await app.inject({
        method: 'POST', url: '/api/auth/verify-email',
        payload: { token: tokenDoTexto(correio.enviadas.at(-1)!.texto) },
      })

      const res = await app.inject({
        method: 'POST', url: '/api/groups', headers: { cookie }, payload: { name: 'Anticorp' },
      })
      expect(res.statusCode).toBe(201)
      await app.close()
    })
  })
})
