import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * O protocolo do Google, e nada alem dele.
 *
 * Este arquivo nao conhece banco, sessao nem Fastify: recebe configuracao,
 * fala com o Google e devolve um perfil. E o que permite testar a parte
 * delicada — validacao de `state`, de PKCE e das reivindicacoes do token — sem
 * subir servidor nenhum.
 *
 * Sem biblioteca de OAuth pelo mesmo motivo que `resend.ts` recusa o SDK
 * oficial e `rota.ts` recusa o react-router: o que usamos de verdade sao dois
 * endpoints e a verificacao de cinco campos, e uma dependencia de
 * autenticacao inteira seria muito mais superficie do que problema.
 */

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

/** Os dois valores que o Google usa em `iss`. Aceitar so um quebraria sem aviso. */
const EMISSORES = ['accounts.google.com', 'https://accounts.google.com']

/** Folga para relogio fora de sincronia entre esta maquina e a do Google. */
const FOLGA_DE_RELOGIO_S = 60

export type PerfilGoogle = {
  /** O `sub`: estavel e imutavel. E por ele que a identidade e chaveada. */
  subject: string
  email: string
  nome: string
  avatarUrl: string | null
}

export class ErroGoogle extends Error {}

const base64url = (b: Buffer): string => b.toString('base64url')

/** `state` e verificador PKCE tem a mesma exigencia: serem imprevisiveis. */
export function segredoDeFluxo(): string {
  return base64url(randomBytes(32))
}

/**
 * O desafio PKCE: SHA-256 do verificador, em base64url.
 *
 * PKCE num cliente confidencial — que tem segredo — nao e obrigatorio, e e
 * barato: fecha a janela em que um codigo interceptado no redirect vale
 * alguma coisa sem o verificador, que nunca trafega pela URL.
 */
export function desafioDe(verificador: string): string {
  return base64url(createHash('sha256').update(verificador).digest())
}

/** Comparacao de `state` em tempo constante. Barato, e remove a duvida. */
export function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function urlDeAutorizacao(opcoes: {
  clientId: string
  redirectUri: string
  state: string
  desafio: string
}): string {
  const p = new URLSearchParams({
    client_id: opcoes.clientId,
    redirect_uri: opcoes.redirectUri,
    response_type: 'code',
    // `openid email profile` e o minimo que responde as tres perguntas que
    // fazemos: quem e (sub), qual o endereco, e como chamar a pessoa na tela.
    scope: 'openid email profile',
    state: opcoes.state,
    code_challenge: opcoes.desafio,
    code_challenge_method: 'S256',
    // Sem isto, quem ja esta logado numa conta Google entra direto nela e nao
    // tem como escolher outra — que e exatamente o problema de quem tem conta
    // pessoal e conta de trabalho no mesmo navegador.
    prompt: 'select_account',
  })
  return `${AUTORIZACAO}?${p.toString()}`
}

export type CargaDoToken = {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  sub?: unknown
  email?: unknown
  email_verified?: unknown
  name?: unknown
  picture?: unknown
}

/**
 * Le a carga do `id_token` SEM verificar a assinatura.
 *
 * Deliberado, e vale explicar: a assinatura existe para provar a origem de um
 * token que chegou por terceiro — pelo navegador, tipicamente. Este token nao
 * chegou assim. Ele veio na resposta de um POST que ESTE processo fez ao
 * endpoint do Google, por TLS, autenticado com o nosso segredo. Quem pudesse
 * forjar essa resposta ja teria quebrado o TLS, e a assinatura nao salvaria.
 *
 * E o que o proprio OpenID Connect Core (secao 3.1.3.7) dispensa para o
 * cliente que recebe o token pelo fluxo de codigo. As reivindicacoes, essas,
 * sao verificadas logo abaixo — nao por excesso de zelo, mas porque um token
 * legitimo emitido para OUTRA aplicacao tambem passaria pelo TLS.
 */
export function lerCarga(idToken: string): CargaDoToken {
  const partes = idToken.split('.')
  if (partes.length !== 3) throw new ErroGoogle('id_token malformado')
  try {
    return JSON.parse(Buffer.from(partes[1]!, 'base64url').toString('utf8')) as CargaDoToken
  } catch {
    throw new ErroGoogle('id_token ilegivel')
  }
}

/**
 * Verifica as reivindicacoes e extrai o perfil.
 *
 * `aud` e a que mais importa: sem ela, um `id_token` valido emitido para
 * qualquer outra aplicacao do mundo entraria aqui como se fosse nosso.
 */
export function perfilDaCarga(carga: CargaDoToken, clientId: string): PerfilGoogle {
  if (typeof carga.iss !== 'string' || !EMISSORES.includes(carga.iss)) {
    throw new ErroGoogle('emissor inesperado')
  }
  if (carga.aud !== clientId) throw new ErroGoogle('token emitido para outra aplicacao')
  if (typeof carga.exp !== 'number' || carga.exp + FOLGA_DE_RELOGIO_S < Date.now() / 1000) {
    throw new ErroGoogle('token expirado')
  }
  if (typeof carga.sub !== 'string' || carga.sub === '') throw new ErroGoogle('token sem sub')
  if (typeof carga.email !== 'string' || carga.email === '') {
    throw new ErroGoogle('token sem e-mail')
  }
  // A regra que sustenta o vinculo por e-mail: so aceitamos entrar numa conta
  // que ja existe porque o Google esta AFIRMANDO que o endereco e de quem
  // entrou. Sem esta checagem, uma conta Google com endereco nao confirmado
  // seria caminho para tomar a conta alheia aqui dentro.
  if (carga.email_verified !== true) throw new ErroGoogle('endereco nao confirmado no Google')

  const cru = typeof carga.name === 'string' && carga.name.trim() !== ''
    ? carga.name.trim().slice(0, 64)
    : carga.email.split('@')[0]!.slice(0, 64)

  return {
    subject: carga.sub,
    email: carga.email,
    // `displayName` tem minimo de 2 no cadastro, e um nome de uma letra so
    // viria de um endereco como "a@x.com" e derrubaria a insercao.
    nome: cru.length >= 2 ? cru : `${cru}.`,
    avatarUrl: typeof carga.picture === 'string' && carga.picture.startsWith('https://')
      ? carga.picture.slice(0, 2048)
      : null,
  }
}

/**
 * Troca o codigo pelo perfil. O segredo do cliente viaja daqui para o Google e
 * de lugar nenhum mais.
 */
export async function trocarCodigo(opcoes: {
  clientId: string
  clientSecret: string
  redirectUri: string
  codigo: string
  verificador: string
}): Promise<PerfilGoogle> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opcoes.clientId,
      client_secret: opcoes.clientSecret,
      code: opcoes.codigo,
      code_verifier: opcoes.verificador,
      grant_type: 'authorization_code',
      redirect_uri: opcoes.redirectUri,
    }),
  })

  if (!res.ok) {
    // O corpo do Google diz o que esta errado — redirect_uri divergente,
    // segredo invalido, codigo ja usado — e sem ele o diagnostico vira
    // adivinhacao. Vai para o log, nunca para a tela.
    const corpo = await res.text().catch(() => '')
    throw new ErroGoogle(`Google recusou a troca (${String(res.status)}): ${corpo.slice(0, 300)}`)
  }

  const corpo = await res.json() as { id_token?: unknown }
  if (typeof corpo.id_token !== 'string') throw new ErroGoogle('resposta sem id_token')

  return perfilDaCarga(lerCarga(corpo.id_token), opcoes.clientId)
}
