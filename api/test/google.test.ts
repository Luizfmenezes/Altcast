import { describe, it, expect } from 'vitest'
import {
  ErroGoogle, desafioDe, lerCarga, mesmoSegredo, perfilDaCarga, segredoDeFluxo, urlDeAutorizacao,
} from '../src/auth/google.js'

/**
 * O protocolo, sem servidor e sem rede.
 *
 * `google.ts` foi escrito sem conhecer banco, sessao nem Fastify exatamente
 * para permitir isto: exercitar a parte delicada — `state`, PKCE e as
 * reivindicacoes do token — em milissegundos, sem container nenhum.
 */

const CLIENT_ID = '000000000000-abcdefg.apps.googleusercontent.com'

/** Monta um id_token sintetico. A assinatura e irrelevante: nao a lemos. */
function tokenCom(carga: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(carga)}.assinatura-nao-lida`
}

const CARGA_BOA = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: '115500000000000000000',
  email: 'pessoa@exemplo.com',
  email_verified: true,
  name: 'Pessoa Exemplo',
  picture: 'https://lh3.googleusercontent.com/foto',
}

describe('protocolo do Google', () => {
  it('o segredo de fluxo nunca se repete', () => {
    const vistos = new Set(Array.from({ length: 50 }, () => segredoDeFluxo()))
    expect(vistos.size).toBe(50)
  })

  it('o desafio PKCE e deterministico e nao devolve o verificador', () => {
    const verificador = segredoDeFluxo()
    expect(desafioDe(verificador)).toBe(desafioDe(verificador))
    expect(desafioDe(verificador)).not.toBe(verificador)
  })

  it('mesmoSegredo compara conteudo, e recusa tamanhos diferentes', () => {
    const a = segredoDeFluxo()
    expect(mesmoSegredo(a, a)).toBe(true)
    expect(mesmoSegredo(a, segredoDeFluxo())).toBe(false)
    expect(mesmoSegredo(a, `${a}x`)).toBe(false)
  })

  it('a URL de autorizacao carrega PKCE e permite trocar de conta', () => {
    const url = new URL(urlDeAutorizacao({
      clientId: CLIENT_ID,
      redirectUri: 'https://altcast.exemplo.com/api/auth/google/callback',
      state: 'abc',
      desafio: 'xyz',
    }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('xyz')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    // Sem isto, quem tem conta pessoal e de trabalho no mesmo navegador entra
    // direto na errada e nao tem como escolher.
    expect(url.searchParams.get('prompt')).toBe('select_account')
    // O verificador NUNCA viaja na URL — e a razao inteira do PKCE.
    expect(url.search).not.toContain('code_verifier')
  })

  it('aceita uma carga legitima', () => {
    const perfil = perfilDaCarga(lerCarga(tokenCom(CARGA_BOA)), CLIENT_ID)
    expect(perfil).toEqual({
      subject: '115500000000000000000',
      email: 'pessoa@exemplo.com',
      nome: 'Pessoa Exemplo',
      avatarUrl: 'https://lh3.googleusercontent.com/foto',
    })
  })

  it('recusa token emitido para OUTRA aplicacao', () => {
    // A checagem que mais importa: sem ela, qualquer id_token valido do mundo
    // entraria aqui como se fosse nosso.
    expect(() => perfilDaCarga(
      lerCarga(tokenCom({ ...CARGA_BOA, aud: 'outro-app.apps.googleusercontent.com' })),
      CLIENT_ID,
    )).toThrow(ErroGoogle)
  })

  it('recusa endereco nao confirmado no Google', () => {
    // E o que sustenta o vinculo por e-mail: sem esta checagem, uma conta
    // Google com endereco nao confirmado tomaria a conta alheia aqui dentro.
    expect(() => perfilDaCarga(
      lerCarga(tokenCom({ ...CARGA_BOA, email_verified: false })), CLIENT_ID,
    )).toThrow(ErroGoogle)
  })

  it('recusa token expirado e emissor inesperado', () => {
    expect(() => perfilDaCarga(
      lerCarga(tokenCom({ ...CARGA_BOA, exp: Math.floor(Date.now() / 1000) - 3600 })), CLIENT_ID,
    )).toThrow(ErroGoogle)
    expect(() => perfilDaCarga(
      lerCarga(tokenCom({ ...CARGA_BOA, iss: 'https://evil.example' })), CLIENT_ID,
    )).toThrow(ErroGoogle)
  })

  it('aceita as duas formas de `iss` que o Google usa', () => {
    for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
      expect(perfilDaCarga(lerCarga(tokenCom({ ...CARGA_BOA, iss })), CLIENT_ID).subject)
        .toBe(CARGA_BOA.sub)
    }
  })

  it('sem nome, cai no inicio do endereco — e nunca com menos de dois caracteres', () => {
    const semNome: Record<string, unknown> = { ...CARGA_BOA }
    delete semNome['name']
    expect(perfilDaCarga(lerCarga(tokenCom(semNome)), CLIENT_ID).nome).toBe('pessoa')

    // `displayName` tem minimo de 2 no cadastro; um endereco "a@x.com"
    // derrubaria a insercao.
    const curto = { ...semNome, email: 'a@x.com' }
    expect(perfilDaCarga(lerCarga(tokenCom(curto)), CLIENT_ID).nome).toHaveLength(2)
  })

  it('descarta foto que nao seja https', () => {
    const perfil = perfilDaCarga(
      lerCarga(tokenCom({ ...CARGA_BOA, picture: 'http://exemplo.com/foto' })), CLIENT_ID,
    )
    expect(perfil.avatarUrl).toBeNull()
  })

  it('recusa token malformado', () => {
    expect(() => lerCarga('isto-nao-e-um-jwt')).toThrow(ErroGoogle)
    expect(() => lerCarga('a.b.c')).toThrow(ErroGoogle)
  })
})
