import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { externalIdentities, users } from '../db/schema.js'
import {
  ErroGoogle, desafioDe, mesmoSegredo, segredoDeFluxo, trocarCodigo, urlDeAutorizacao,
  type PerfilGoogle,
} from '../auth/google.js'
import { createSession } from '../auth/session.js'
import { emit } from '../realtime/emit.js'
import { resgatarConvites } from './invitations.routes.js'
import { logger } from '../shared/logger.js'
import { newId } from '../shared/ids.js'
import { env } from '../env.js'

/**
 * A entrada pelo Google.
 *
 * Duas rotas e nenhum JavaScript: o navegador sai daqui por um redirecionamento
 * e volta por outro, e no fim recebe o MESMO cookie de sessao do login por
 * senha. O front nao ganha um segundo modelo de autenticacao para manter — o
 * botao e um link comum.
 *
 * Isso tambem e o que faz o aplicativo de desktop funcionar sem trabalho
 * extra: ele abre a aplicacao pela mesma origem, e um fluxo que vive inteiro
 * em redirecionamentos de servidor nao depende de popup, de `postMessage` nem
 * de SDK carregado na pagina.
 */

const PROVEDOR = 'google'

/**
 * O cookie de dez minutos que carrega `state` e verificador PKCE.
 *
 * Mora num cookie, e nao numa tabela, porque a funcao dele e exatamente amarrar
 * a volta ao navegador que saiu — uma tabela sozinha nao faz isso, e ainda
 * pediria faxina. O `path` restrito significa que ele nao acompanha nenhuma
 * outra requisicao da aplicacao.
 */
const COOKIE_FLUXO = 'altcast_oauth'
const PATH_FLUXO = '/api/auth/google'
const VALIDADE_FLUXO_S = 600

type Config = { clientId: string; clientSecret: string; redirectUri: string }

/**
 * Sem as duas variaveis a API sobe inteira e so o botao some da tela — mesma
 * politica do armazenamento de anexos e do correio.
 */
function configDoAmbiente(): Config | null {
  if (env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined) return null
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_URL}/api/auth/google/callback`,
  }
}

function cookieDeSessao(): Parameters<FastifyReply['setCookie']>[2] {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86_400,
  }
}

/**
 * Resolve quem entrou, na ordem que a decisao do produto exige.
 *
 * 1. Identidade `(google, sub)` ja vinculada: e essa conta, sem ambiguidade.
 * 2. Conta com o MESMO endereco: vincula e entra. So e seguro porque
 *    `perfilDaCarga` ja exigiu `email_verified` — sem essa checagem, uma conta
 *    Google com endereco nao confirmado seria caminho para tomar a conta
 *    alheia aqui dentro.
 * 3. Ninguem: cria a conta ja com o endereco confirmado. Conta nascida assim
 *    nunca encontra a trava de verificacao, que e o ponto: o Google e a saida
 *    para quem o nosso e-mail nao alcanca.
 */
async function entrarComPerfil(perfil: PerfilGoogle): Promise<{
  userId: string
  gruposResgatados: string[]
  displayName: string
  avatarUrl: string | null
}> {
  const [identidade] = await db.select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(eq(externalIdentities.subject, perfil.subject))
    .limit(1)

  if (identidade) {
    const [u] = await db.select().from(users).where(eq(users.id, identidade.userId)).limit(1)
    if (u) {
      return {
        userId: u.id, gruposResgatados: [],
        displayName: u.displayName, avatarUrl: u.avatarUrl,
      }
    }
  }

  const [existente] = await db.select().from(users)
    .where(eq(users.email, perfil.email)).limit(1)

  if (existente) {
    await db.transaction(async tx => {
      await tx.insert(externalIdentities).values({
        provider: PROVEDOR, subject: perfil.subject,
        userId: existente.id, email: perfil.email,
      }).onConflictDoNothing()
      // Confirmar o endereco aqui e mais do que cortesia: quem entrou por uma
      // conta Google verificada ja provou o que o nosso e-mail tentava provar,
      // e sem isto a trava de criar grupo continuaria de pe para ele.
      if (existente.emailVerifiedAt === null) {
        await tx.update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, existente.id))
      }
      // A foto so preenche buraco. Sobrescrever um avatar escolhido aqui
      // dentro pela foto do Google seria desfazer uma decisao da pessoa.
      if (existente.avatarUrl === null && perfil.avatarUrl !== null) {
        await tx.update(users).set({ avatarUrl: perfil.avatarUrl })
          .where(eq(users.id, existente.id))
      }
    })
    return {
      userId: existente.id, gruposResgatados: [],
      displayName: existente.displayName,
      avatarUrl: existente.avatarUrl ?? perfil.avatarUrl,
    }
  }

  const userId = newId()
  const gruposResgatados = await db.transaction(async tx => {
    await tx.insert(users).values({
      id: userId,
      email: perfil.email,
      // Nulo, e nao um hash inventado: a coluna deixou de ser NOT NULL na
      // migracao 0009 exatamente para poder dizer a verdade aqui. Quem quiser
      // uma senha depois passa pelo "esqueci a senha", que ja existe.
      passwordHash: null,
      displayName: perfil.nome,
      avatarUrl: perfil.avatarUrl,
      emailVerifiedAt: new Date(),
    })
    await tx.insert(externalIdentities).values({
      provider: PROVEDOR, subject: perfil.subject, userId, email: perfil.email,
    })
    // Mesma transacao que a criacao da conta, como no cadastro por senha.
    return resgatarConvites(tx, userId, perfil.email)
  })

  return {
    userId, gruposResgatados,
    displayName: perfil.nome, avatarUrl: perfil.avatarUrl,
  }
}

export async function googleRoutes(app: FastifyInstance): Promise<void> {
  /**
   * O que este servidor oferece. Existe para o front nao desenhar um botao
   * que leva a lugar nenhum — a configuracao e do operador, e a tela precisa
   * saber qual e.
   */
  app.get('/api/auth/providers', async () => ({ google: configDoAmbiente() !== null }))

  app.get('/api/auth/google/start', {
    // Por IP: a rota e publica e cada visita gera um redirecionamento ao
    // Google. Folgado o bastante para quem erra a conta duas vezes.
    config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: req => req.ip } },
  }, async (req, reply) => {
    const config = configDoAmbiente()
    if (config === null) return reply.redirect(`${env.PUBLIC_URL}/entrar?erro=google_indisponivel`)

    const state = segredoDeFluxo()
    const verificador = segredoDeFluxo()
    // O convite que a pessoa trouxe ate a porta. Viaja no cookie assinado, e
    // nao no `state` do Google: o `state` e segredo de CSRF e precisa ser
    // imprevisivel — misturar dado de aplicacao nele enfraqueceria as duas
    // coisas. So um codigo com a forma de codigo passa; o resto e descartado.
    const bruto = (req.query as { convite?: unknown }).convite
    const convite = typeof bruto === 'string' && /^[0-9A-Za-z-]{1,32}$/.test(bruto)
      ? bruto
      : undefined

    reply.setCookie(COOKIE_FLUXO, JSON.stringify({ state, verificador, convite }), {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      // `lax`, e nao `strict`: o cookie precisa SOBREVIVER a volta do Google,
      // que e uma navegacao vinda de outro site. Com `strict` ele nao seria
      // enviado no callback e todo fluxo falharia na comparacao do `state`.
      sameSite: 'lax',
      path: PATH_FLUXO,
      maxAge: VALIDADE_FLUXO_S,
      signed: true,
    })

    return reply.redirect(urlDeAutorizacao({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      desafio: desafioDe(verificador),
    }))
  })

  /**
   * A volta.
   *
   * Todo caminho de falha termina em redirecionamento para a tela de entrada
   * com um aviso — nunca num JSON de erro. Quem esta aqui e um navegador no
   * meio de uma navegacao, e o envelope de erro da spec 06 apareceria como
   * texto cru numa aba em branco.
   */
  app.get('/api/auth/google/callback', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: req => req.ip } },
  }, async (req, reply) => {
    const falhar = (motivo: string, detalhe?: unknown): FastifyReply => {
      // O detalhe vai para o log e nunca para a tela: a resposta do Google
      // sobre um redirect_uri divergente ou um segredo invalido e diagnostico
      // de operacao, nao mensagem de usuario.
      if (detalhe !== undefined) logger.warn({ motivo, detalhe }, 'entrada pelo Google falhou')
      else logger.warn({ motivo }, 'entrada pelo Google falhou')
      reply.clearCookie(COOKIE_FLUXO, { path: PATH_FLUXO })
      return reply.redirect(`${env.PUBLIC_URL}/entrar?erro=google`)
    }

    const config = configDoAmbiente()
    if (config === null) return falhar('nao_configurado')

    const q = req.query as { code?: string; state?: string; error?: string }
    // O Google manda `error=access_denied` quando a pessoa desiste na tela
    // dele. Nao e falha: e uma decisao, e volta para o login sem alarde.
    if (typeof q.error === 'string') {
      reply.clearCookie(COOKIE_FLUXO, { path: PATH_FLUXO })
      return reply.redirect(`${env.PUBLIC_URL}/entrar`)
    }
    if (typeof q.code !== 'string' || typeof q.state !== 'string') {
      return falhar('resposta_incompleta')
    }

    const bruto = req.cookies[COOKIE_FLUXO]
    if (bruto === undefined) return falhar('sem_cookie_de_fluxo')
    const aberto = req.unsignCookie(bruto)
    if (!aberto.valid || aberto.value === null) return falhar('cookie_adulterado')

    let guardado: { state?: unknown; verificador?: unknown; convite?: unknown }
    try {
      guardado = JSON.parse(aberto.value) as {
        state?: unknown; verificador?: unknown; convite?: unknown
      }
    } catch {
      return falhar('cookie_ilegivel')
    }
    if (typeof guardado.state !== 'string' || typeof guardado.verificador !== 'string') {
      return falhar('cookie_incompleto')
    }
    // Aqui mora a defesa contra CSRF de login: sem esta comparacao, alguem
    // poderia fazer a SUA sessao entrar na conta DELE por um link.
    if (!mesmoSegredo(guardado.state, q.state)) return falhar('state_divergente')

    let perfil: PerfilGoogle
    try {
      perfil = await trocarCodigo({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        codigo: q.code,
        verificador: guardado.verificador,
      })
    } catch (e) {
      return falhar('troca_recusada', e instanceof ErroGoogle ? e.message : String(e))
    }

    let entrada: Awaited<ReturnType<typeof entrarComPerfil>>
    try {
      entrada = await entrarComPerfil(perfil)
    } catch (e) {
      return falhar('vinculo_falhou', e instanceof Error ? e.message : String(e))
    }

    // Depois do commit, como em todo aceite de convite: quem ja estava no
    // grupo ve o membro novo aparecer sem recarregar.
    for (const groupId of entrada.gruposResgatados) {
      await emit.toGroup(groupId, {
        t: 'member.joined',
        d: {
          groupId, userId: entrada.userId, role: 'member', status: 'online',
          displayName: entrada.displayName, avatarUrl: entrada.avatarUrl,
        },
      })
    }

    const s = await createSession(entrada.userId, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieDeSessao())
    reply.clearCookie(COOKIE_FLUXO, { path: PATH_FLUXO })

    // Para a raiz, e nao para `/entrar`: a sessao ja existe, e o `App` decide
    // o que mostrar consultando `/auth/me`. Com convite em curso, o endereco o
    // devolve ao aplicativo, que aceita e abre o grupo — o mesmo desfecho do
    // login por senha.
    const convite = typeof guardado.convite === 'string' ? guardado.convite : null
    return reply.redirect(convite === null
      ? `${env.PUBLIC_URL}/`
      : `${env.PUBLIC_URL}/entrar?convite=${encodeURIComponent(convite)}`)
  })
}
