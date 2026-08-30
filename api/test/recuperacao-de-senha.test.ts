import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { criarUsuario } from './helpers/fixtures.js'
import { buildServer } from '../src/index.js'
import { correioDeRegistro } from '../src/email/registro.js'

const SENHA = 'uma frase longa que so eu sei'
const NOVA = 'outra frase igualmente comprida'

function tokenDoTexto(texto: string): string {
  const achado = /https?:\/\/\S+\/redefinir\/([A-Za-z0-9_-]+)/.exec(texto)
  if (!achado?.[1]) throw new Error(`nenhum token no e-mail:\n${texto}`)
  return achado[1]
}

async function pedirRecuperacao(
  app: Awaited<ReturnType<typeof buildServer>>,
  correio: ReturnType<typeof correioDeRegistro>,
  email = 'f@x.com',
): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } })
  return tokenDoTexto(correio.enviadas.at(-1)!.texto)
}

describe('pedido de recuperacao', () => {
  it('manda o e-mail para quem tem conta', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })

      const res = await app.inject({
        method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'f@x.com' },
      })
      expect(res.statusCode).toBe(204)
      expect(correio.enviadas).toHaveLength(1)
      expect(correio.enviadas[0]!.assunto).toContain('senha')
      await app.close()
    })
  })

  /**
   * O ponto central desta rota. Uma resposta diferente para endereco
   * inexistente transformaria `forgot-password` num verificador de quem tem
   * conta aqui — e a lista de e-mails de um lugar e, sozinha, informacao.
   */
  it('responde igual para e-mail que nao existe, e nao manda nada', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })

      const existe = await app.inject({
        method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'f@x.com' },
      })
      const naoExiste = await app.inject({
        method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ninguem@x.com' },
      })

      expect(existe.statusCode).toBe(naoExiste.statusCode)
      expect(existe.body).toBe(naoExiste.body)
      // So o primeiro pedido gerou mensagem.
      expect(correio.enviadas).toHaveLength(1)
      await app.close()
    })
  })

  it('e-mail malformado tambem sai por 204, sem pista de formato', async () => {
    await withTestDb(async () => {
      const app = await buildServer({ correio: correioDeRegistro() })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nao-e-email' },
      })
      expect(res.statusCode).toBe(204)
      await app.close()
    })
  })
})

describe('redefinicao', () => {
  it('o link troca a senha, e a nova passa a valer', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const token = await pedirRecuperacao(app, correio)

      const res = await app.inject({
        method: 'POST', url: '/api/auth/reset-password', payload: { token, password: NOVA },
      })
      expect(res.statusCode).toBe(204)

      const comNova = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'f@x.com', password: NOVA },
      })
      expect(comNova.statusCode).toBe(200)

      const comVelha = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'f@x.com', password: SENHA },
      })
      expect(comVelha.statusCode).toBe(401)
      await app.close()
    })
  })

  /**
   * O motivo mais comum de alguem redefinir a senha e ter perdido a conta para
   * outra pessoa. Se as sessoes antigas sobrevivessem, a recuperacao nao
   * expulsaria de dentro dela quem a tomou — e nao seria recuperacao nenhuma.
   */
  it('derruba as sessoes que existiam antes', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })

      const entrada = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { email: 'f@x.com', password: SENHA },
      })
      const cookieAntigo = entrada.headers['set-cookie'] as string
      expect((await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: cookieAntigo },
      })).statusCode).toBe(200)

      const token = await pedirRecuperacao(app, correio)
      await app.inject({
        method: 'POST', url: '/api/auth/reset-password', payload: { token, password: NOVA },
      })

      const depois = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: cookieAntigo },
      })
      expect(depois.statusCode).toBe(401)
      await app.close()
    })
  })

  it('o mesmo link nao serve duas vezes', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const token = await pedirRecuperacao(app, correio)

      await app.inject({
        method: 'POST', url: '/api/auth/reset-password', payload: { token, password: NOVA },
      })
      const segunda = await app.inject({
        method: 'POST', url: '/api/auth/reset-password',
        payload: { token, password: 'mais uma frase bem comprida' },
      })
      expect(segunda.statusCode).toBe(400)
      await app.close()
    })
  })

  it('pedir de novo invalida o link anterior', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })

      const primeiro = await pedirRecuperacao(app, correio)
      const segundo = await pedirRecuperacao(app, correio)
      expect(segundo).not.toBe(primeiro)

      const velho = await app.inject({
        method: 'POST', url: '/api/auth/reset-password',
        payload: { token: primeiro, password: NOVA },
      })
      expect(velho.statusCode).toBe(400)
      await app.close()
    })
  })

  it('token inventado e recusado, com a mesma mensagem do vencido', async () => {
    await withTestDb(async () => {
      const app = await buildServer({ correio: correioDeRegistro() })
      const res = await app.inject({
        method: 'POST', url: '/api/auth/reset-password',
        payload: { token: 'z'.repeat(43), password: NOVA },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('reset_token_invalid')
      await app.close()
    })
  })

  it('senha fraca e recusada mesmo com token valido', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const correio = correioDeRegistro()
      const app = await buildServer({ correio })
      const token = await pedirRecuperacao(app, correio)

      const res = await app.inject({
        method: 'POST', url: '/api/auth/reset-password', payload: { token, password: '123' },
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })
})

describe('troca de senha autenticada', () => {
  async function entrar(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'f@x.com', password: SENHA },
    })
    return res.headers['set-cookie'] as string
  }

  it('exige a senha atual', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const app = await buildServer({ correio: correioDeRegistro() })
      const cookie = await entrar(app)

      const res = await app.inject({
        method: 'PATCH', url: '/api/auth/password', headers: { cookie },
        payload: { currentPassword: 'chute errado e longo', newPassword: NOVA },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('wrong_password')
      await app.close()
    })
  })

  it('troca a senha e mantem esta aba entrando', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const app = await buildServer({ correio: correioDeRegistro() })
      const cookie = await entrar(app)

      const res = await app.inject({
        method: 'PATCH', url: '/api/auth/password', headers: { cookie },
        payload: { currentPassword: SENHA, newPassword: NOVA },
      })
      expect(res.statusCode).toBe(204)

      // A resposta traz um cookie novo; quem trocou a senha nao e deslogado.
      const cookieNovo = res.headers['set-cookie'] as string
      expect(cookieNovo).toBeTruthy()
      const me = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: cookieNovo },
      })
      expect(me.statusCode).toBe(200)
      await app.close()
    })
  })

  it('mas derruba as outras sessoes', async () => {
    await withTestDb(async db => {
      await criarUsuario(db, { email: 'f@x.com', senha: SENHA })
      const app = await buildServer({ correio: correioDeRegistro() })
      const outroAparelho = await entrar(app)
      const esteAparelho = await entrar(app)

      await app.inject({
        method: 'PATCH', url: '/api/auth/password', headers: { cookie: esteAparelho },
        payload: { currentPassword: SENHA, newPassword: NOVA },
      })

      const outro = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: outroAparelho },
      })
      expect(outro.statusCode).toBe(401)
      await app.close()
    })
  })
})
