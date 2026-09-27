import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  emailVerificationTokens, groupMembers, groups, passwordResetTokens, users,
} from '../db/schema.js'
import { DUMMY_HASH, assertPasswordAcceptable, hashPassword, verifyPassword } from '../auth/password.js'
import {
  createSession, listSessions, revokeAllSessions, revokeOtherSessions, revokeSession,
  revokeSessionByHandle,
} from '../auth/session.js'
import {
  VALIDADE_RESET_MS, VALIDADE_VERIFICACAO_MS, emitirToken, hashDoToken,
} from '../auth/tokens.js'
import type { Correio } from '../email/tipos.js'
import { correioPadrao } from '../email/index.js'
import { emailDeRecuperacao, emailDeVerificacao } from '../email/modelos.js'
import { logger } from '../shared/logger.js'
import { requireAuth } from '../auth/middleware.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { normalizeInviteCode } from '../invites/code.js'
import { cotaDeGrupos } from '../groups/limite.js'
import {
  INTERVALO_DE_TROCA_MS, normalizarUsername, problemaNoUsername,
} from '../auth/username.js'
import { parse } from './groups.routes.js'
import { consumirConvite } from './invites.routes.js'
import { resgatarConvites } from './invitations.routes.js'
import { emit } from '../realtime/emit.js'
import { env } from '../env.js'

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(1024),
})

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
  displayName: z.string().trim().min(2).max(64),
  /**
   * Opcional desde que o cadastro abriu.
   *
   * Com codigo, a conta nasce ja dentro do grupo, na mesma transacao — o
   * comportamento antigo, intacto. Sem codigo, nasce sozinha e a pessoa cria
   * o proprio grupo ou aceita um convite depois.
   *
   * O convite deixou de ser a porta e virou um atalho. Quem paga essa conta e
   * a verificacao de e-mail, que antes era dispensavel justamente porque a
   * lista de convidados fazia o trabalho dela.
   */
  inviteCode: z.string().min(1).max(32).optional(),
})

const emailSchema = z.object({ email: z.email().max(254) })
const tokenSchema = z.object({ token: z.string().min(16).max(512) })
const resetSchema = tokenSchema.extend({ password: z.string().min(1).max(1024) })
const trocaDeSenhaSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
})
const perfilSchema = z.object({
  displayName: z.string().trim().min(2).max(64).optional(),
  /**
   * `z.url()`, e nao `z.string()` como antes.
   *
   * Texto livre aqui permitia apontar o proprio avatar para
   * `/api/avatars/<id de outra pessoa>` — ou para um pixel de rastreio que
   * todo membro de todo grupo compartilhado carregaria a cada abertura. Com
   * endereco absoluto obrigatorio, o unico jeito de por um caminho nosso
   * nessa coluna e pela rota de upload, que tambem grava a chave do objeto.
   */
  avatarUrl: z.url().max(2048).nullable().optional(),
})

const usernameSchema = z.object({ username: z.string().min(1).max(64) })

/**
 * Isto foi o indice unico de `username` reclamando?
 *
 * Sobe ate quatro niveis de `cause` porque o driver embrulha o erro do
 * Postgres. Confere tambem o NOME do indice: `23505` sozinho diria apenas
 * "alguma unicidade", e transformar uma violacao qualquer em "este nome ja
 * esta em uso" mentiria — foi exatamente esse tipo de confusao que o commit
 * e66bc28 corrigiu no convite.
 */
function ehUnicidadeDeUsername(erro: unknown): boolean {
  let atual: unknown = erro
  for (let i = 0; i < 4 && atual !== null && atual !== undefined; i++) {
    const e = atual as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (e.code === '23505' && e.constraint === 'users_username_key') return true
    atual = e.cause
  }
  return false
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86_400,
  }
}

/** O limite de rotas nao autenticadas e por origem de rede, nao por sessao. */
const porIp = (req: FastifyRequest): string => req.ip

/**
 * Emite um token de confirmacao e manda o e-mail.
 *
 * Invalida os pedidos anteriores da mesma conta: dois links validos ao mesmo
 * tempo dobram a janela de exposicao sem servir para nada — quem pediu de novo
 * vai usar o que acabou de chegar.
 */
async function enviarVerificacao(correio: Correio, alvo: {
  userId: string
  email: string
  nome: string
}): Promise<void> {
  const { token, hash, expiraEm } = emitirToken(VALIDADE_VERIFICACAO_MS)

  await db.transaction(async tx => {
    await tx.update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(emailVerificationTokens.userId, alvo.userId),
        isNull(emailVerificationTokens.usedAt),
      ))
    await tx.insert(emailVerificationTokens).values({
      tokenHash: hash, userId: alvo.userId, email: alvo.email, expiresAt: expiraEm,
    })
  })

  await correio.enviar(emailDeVerificacao({
    para: alvo.email,
    nome: alvo.nome,
    url: `${env.PUBLIC_URL}/verificar/${token}`,
  }))
}

export async function authRoutes(app: FastifyInstance, opcoes?: {
  correio?: Correio
}): Promise<void> {
  // Sem chave do Resend a API sobe assim mesmo e o link vai para o log. Em
  // desenvolvimento isso percorre o fluxo inteiro sem credencial nenhuma.
  const correio: Correio = opcoes?.correio ?? correioPadrao()

  /**
   * Sem teto proprio: o cadastro cai no limite geral da aplicacao.
   *
   * O limite anterior era de tres por hora por IP, e a premissa dele — que
   * ninguem cria tres contas por hora de boa-fe — nao sobreviveu ao uso real.
   * Um escritorio, uma faculdade ou uma casa inteira sai por um IP so, e a
   * quarta pessoa a aceitar o mesmo convite batia em 429 sem ter o que fazer
   * pela hora seguinte. O limite protegia contra um cadastro em massa que o
   * convite obrigatorio ja impede, e cobrava o preco de quem estava fazendo a
   * coisa certa.
   *
   * O que continua de pe: cadastro exige codigo de convite valido (secao 1 da
   * spec 03), a previa de convite segue limitada a 20 por minuto por IP, e o
   * teto geral da aplicacao vale aqui como em qualquer outra rota.
   */
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError('validation_failed', z.flattenError(parsed.error).fieldErrors)
    }
    const { email, password, displayName } = parsed.data
    const inviteCode = parsed.data.inviteCode === undefined
      ? null
      : normalizeInviteCode(parsed.data.inviteCode)

    assertPasswordAcceptable(password)

    const [existente] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, email)).limit(1)
    if (existente) throw new AppError('email_taken')

    // Fora da transacao: argon2id com 19 MiB leva centenas de milissegundos e
    // seguraria a linha travada do convite por todo esse tempo.
    const passwordHash = await hashPassword(password)

    const userId = newId()
    let entrou: string[] = []
    await db.transaction(async tx => {
      await tx.insert(users).values({ id: userId, email, passwordHash, displayName })
      // Mesma transacao que a criacao da conta: um convite esgotado sem conta
      // criada, ou uma conta orfa sem grupo, seriam os dois estados que
      // nenhuma tela sabe consertar.
      if (inviteCode !== null) entrou.push(await consumirConvite(tx, inviteCode, userId))
      // Convite dirigido a ESTE endereco, feito antes de a conta existir.
      //
      // Aqui, e nao numa tela depois do cadastro: quem foi convidado por
      // e-mail nem sabe que existe um convite a aceitar — ele veio para
      // entrar num grupo, e pedir um segundo clique para concluir o que ja
      // estava decidido so cria um lugar onde desistir.
      entrou = entrou.concat(await resgatarConvites(tx, userId, email))
    })

    for (const groupId of [...new Set(entrou)]) {
      await emit.toGroup(groupId, {
        t: 'member.joined',
        d: {
          groupId, userId, role: 'member', status: 'online', displayName, avatarUrl: null,
        },
      })
    }

    // Falha de envio nao derruba o cadastro. A conta esta criada e a pessoa ja
    // entrou; o que falta e um e-mail que ela pode pedir de novo pela propria
    // interface. Estourar aqui devolveria 500 para um cadastro que deu certo.
    await enviarVerificacao(correio, {
      userId, email, nome: displayName,
    }).catch((e: unknown) => {
      logger.error({ erro: e instanceof Error ? e.message : String(e), userId },
        'cadastro criado, e-mail de verificacao nao saiu')
    })

    const s = await createSession(userId, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieOptions())
    return reply.status(201).send({
      user: {
        id: userId, email, displayName, avatarUrl: null, emailVerifiedAt: null,
      },
    })
  })

  app.post('/api/auth/login', {
    // 5 por minuto por IP freia a forca bruta distribuida por contas; o
    // segundo limite, 10 por hora por e-mail, freia a forca bruta concentrada
    // numa conta so, que trocar de IP contornaria. Sao eixos diferentes, e por
    // isso dois limitadores em vez de um.
    config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: porIp } },
    preHandler: app.rateLimit({
      max: 10, timeWindow: '1 hour',
      keyGenerator: req => {
        const email = (req.body as { email?: unknown })?.email
        return typeof email === 'string' ? `login:${email.toLowerCase()}` : req.ip
      },
    }),
  }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('validation_failed')
    const { email, password } = parsed.data

    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)

    // A verificacao roda SEMPRE, inclusive quando o usuario nao existe. Sem
    // ela a resposta para e-mail inexistente voltaria em microssegundos e a
    // diferenca de tempo entregaria a lista de quem tem conta.
    const hash = u?.passwordHash ?? DUMMY_HASH
    const ok = await verifyPassword(hash, password)
    if (!u || !ok) throw new AppError('invalid_credentials')

    const s = await createSession(u.id, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieOptions())
    return { user: { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl } }
  })

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (req.sessionId !== undefined) await revokeSession(req.sessionId)
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/sessions', { preHandler: requireAuth }, async req =>
    listSessions(req.user!.id, req.sessionId!))

  /** Encerra todas as outras sessoes da conta e devolve quantas eram. */
  app.delete('/api/auth/sessions', { preHandler: requireAuth }, async req => ({
    revoked: await revokeOtherSessions(req.user!.id, req.sessionId!),
  }))

  app.delete('/api/auth/sessions/:handle', { preHandler: requireAuth }, async (req, reply) => {
    const { handle } = req.params as { handle: string }
    const revogou = await revokeSessionByHandle(req.user!.id, handle)
    // Sessao de outra conta e sessao inexistente recebem a mesma resposta: um
    // 403 aqui confirmaria que aquele identificador existe em algum lugar.
    if (!revogou) throw new AppError('not_found')
    return reply.status(204).send()
  })

  /**
   * Confirma o endereco.
   *
   * Publica de proposito: o link chega ao e-mail e e clicado, muitas vezes,
   * num aparelho onde ninguem entrou ainda. Exigir sessao aqui quebraria
   * justamente o caso comum.
   */
  app.post('/api/auth/verify-email', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: porIp } },
  }, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('verification_token_invalid')

    const [linha] = await db.select().from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, hashDoToken(parsed.data.token)))
      .limit(1)

    if (!linha || linha.usedAt !== null || linha.expiresAt <= new Date()) {
      throw new AppError('verification_token_invalid')
    }

    await db.transaction(async tx => {
      await tx.update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.tokenHash, linha.tokenHash))
      // `email` vem do token, e nao de users: e o que faz este mesmo caminho
      // servir para confirmar uma TROCA de endereco.
      await tx.update(users)
        .set({ email: linha.email, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, linha.userId))
    })

    return reply.status(204).send()
  })

  app.post('/api/auth/resend-verification', {
    preHandler: requireAuth,
    config: {
      rateLimit: {
        max: 3, timeWindow: '1 hour',
        keyGenerator: (req: FastifyRequest) => `verificar:${req.user?.id ?? req.ip}`,
      },
    },
  }, async (req, reply) => {
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1)
    if (!u) throw new AppError('unauthenticated')
    // Ja confirmado responde igual a recem-enviado: nada a fazer, nada a contar.
    if (u.emailVerifiedAt === null) {
      await enviarVerificacao(correio, {
        userId: u.id, email: u.email, nome: u.displayName,
      })
    }
    return reply.status(204).send()
  })

  /**
   * Pede a recuperacao de senha.
   *
   * Responde 204 SEMPRE — e-mail cadastrado ou nao, envio bem-sucedido ou nao.
   * E a mesma razao do DUMMY_HASH no login: uma resposta diferente para
   * endereco inexistente transforma esta rota num verificador de quem tem
   * conta aqui.
   */
  app.post('/api/auth/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: porIp } },
    preHandler: app.rateLimit({
      max: 3, timeWindow: '1 hour',
      keyGenerator: req => {
        const email = (req.body as { email?: unknown })?.email
        return typeof email === 'string' ? `recuperar:${email.toLowerCase()}` : req.ip
      },
    }),
  }, async (req, reply) => {
    const parsed = emailSchema.safeParse(req.body)
    // Corpo invalido tambem sai por 204: dizer "e-mail malformado" e dizer que
    // o formato importa, e o silencio aqui custa menos do que a pista.
    if (!parsed.success) return reply.status(204).send()

    const [u] = await db.select().from(users)
      .where(eq(users.email, parsed.data.email)).limit(1)

    if (u) {
      const { token, hash, expiraEm } = emitirToken(VALIDADE_RESET_MS)
      await db.transaction(async tx => {
        // Pedir de novo invalida o pedido anterior: dois links vivos ao mesmo
        // tempo so alargam a janela de exposicao.
        await tx.update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(and(
            eq(passwordResetTokens.userId, u.id),
            isNull(passwordResetTokens.usedAt),
          ))
        await tx.insert(passwordResetTokens).values({
          tokenHash: hash, userId: u.id, expiresAt: expiraEm,
        })
      })

      await correio.enviar(emailDeRecuperacao({
        para: u.email,
        nome: u.displayName,
        url: `${env.PUBLIC_URL}/redefinir/${token}`,
      })).catch((e: unknown) => {
        logger.error({ erro: e instanceof Error ? e.message : String(e) },
          'e-mail de recuperacao nao saiu')
      })
    }

    return reply.status(204).send()
  })

  app.post('/api/auth/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: porIp } },
  }, async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('reset_token_invalid')

    assertPasswordAcceptable(parsed.data.password)

    const [linha] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashDoToken(parsed.data.token)))
      .limit(1)

    if (!linha || linha.usedAt !== null || linha.expiresAt <= new Date()) {
      throw new AppError('reset_token_invalid')
    }

    const passwordHash = await hashPassword(parsed.data.password)

    await db.transaction(async tx => {
      await tx.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.tokenHash, linha.tokenHash))
      await tx.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, linha.userId))
    })

    // Trocar a senha derruba TODAS as sessoes, inclusive as de quem quer que
    // tenha entrado com a senha antiga. Sem isto, recuperar a conta nao
    // expulsaria de dentro dela quem a tomou — que e o motivo mais comum de
    // alguem estar redefinindo a senha.
    await revokeAllSessions(linha.userId)

    return reply.status(204).send()
  })

  app.patch('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = trocaDeSenhaSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError('validation_failed')

    assertPasswordAcceptable(parsed.data.newPassword)

    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1)
    if (!u) throw new AppError('unauthenticated')
    // Conta nascida pelo Google nao tem senha atual para conferir. Dizer isso
    // e seguro — quem recebe a mensagem ja provou ser o dono da sessao — e e
    // melhor do que um "senha atual incorreta" que nao tem como ficar certo.
    // O caminho para CRIAR a primeira senha e o "esqueci a senha" que ja
    // existe: ele emite o token e o reset grava o hash, sem codigo novo.
    if (u.passwordHash === null) throw new AppError('no_password_set')
    if (!await verifyPassword(u.passwordHash, parsed.data.currentPassword)) {
      throw new AppError('wrong_password')
    }

    await db.update(users)
      .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
      .where(eq(users.id, u.id))

    // Derruba as OUTRAS sessoes e abre uma nova para esta aba: quem acabou de
    // provar que sabe a senha atual nao precisa entrar de novo onde esta.
    await revokeAllSessions(u.id)
    const s = await createSession(u.id, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    })
    reply.setCookie(env.SESSION_COOKIE_NAME, s.id, cookieOptions())

    return reply.status(204).send()
  })

  app.patch('/api/auth/me', { preHandler: requireAuth }, async req => {
    const parsed = perfilSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError('validation_failed', z.flattenError(parsed.error).fieldErrors)
    }

    const mudancas: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.displayName !== undefined) mudancas['displayName'] = parsed.data.displayName
    if (parsed.data.avatarUrl !== undefined) {
      mudancas['avatarUrl'] = parsed.data.avatarUrl
      // Apontar a foto para outro lugar desliga a que estava hospedada aqui.
      // Sem isto a chave continuaria apontando para um objeto que ninguem mais
      // exibe e que ninguem mais saberia apagar.
      mudancas['avatarKey'] = null
    }

    const [u] = await db.update(users).set(mudancas)
      .where(eq(users.id, req.user!.id)).returning()
    if (!u) throw new AppError('unauthenticated')

    // Sem isto, trocar o nome de exibicao era invisivel para todo mundo ate a
    // proxima recarga — uma lacuna que existia antes deste trabalho.
    void emit.toPeersOf(u.id, {
      t: 'user.updated',
      d: { userId: u.id, displayName: u.displayName, username: u.username, avatarUrl: u.avatarUrl },
    })

    return {
      user: {
        id: u.id, email: u.email, displayName: u.displayName, username: u.username,
        avatarUrl: u.avatarUrl, emailVerifiedAt: u.emailVerifiedAt,
      },
    }
  })

  /**
   * Trocar o nome de usuario.
   *
   * Rota propria, e nao um campo no PATCH geral: o limite de troca e o
   * conflito de unicidade sao especificos deste campo, e junta-los faria uma
   * troca de APELIDO poder falhar com "voce ja trocou o nome de usuario este
   * mes" — uma mensagem sobre outra coisa.
   */
  app.patch('/api/auth/me/username', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async req => {
    const { username: bruto } = parse(usernameSchema, req.body)
    const motivo = problemaNoUsername(bruto)
    if (motivo !== null) throw new AppError('validation_failed', { username: [motivo] })

    const username = normalizarUsername(bruto)
    const userId = req.user!.id

    const [atual] = await db
      .select({ username: users.username, trocadoEm: users.usernameChangedAt })
      .from(users).where(eq(users.id, userId)).limit(1)
    if (!atual) throw new AppError('unauthenticated')

    // Pedir o mesmo handle que ja se tem nao e uma troca, e nao gasta a cota.
    if (atual.username === username) {
      return { user: { id: userId, username } }
    }
    if (
      atual.trocadoEm !== null
      && Date.now() - atual.trocadoEm.getTime() < INTERVALO_DE_TROCA_MS
    ) {
      throw new AppError('username_change_too_soon')
    }

    try {
      await db.update(users)
        .set({ username, usernameChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId))
    } catch (erro) {
      // A unicidade vem do INDICE, e nao de um SELECT antes do UPDATE: dois
      // pedidos simultaneos pelo mesmo handle leriam "livre" os dois, e o
      // segundo sobrescreveria o primeiro sem ninguem notar.
      if (ehUnicidadeDeUsername(erro)) throw new AppError('username_taken')
      throw erro
    }

    void emit.toPeersOf(userId, { t: 'user.updated', d: { userId, username } })
    return { user: { id: userId, username } }
  })

  /**
   * Quem e esta pessoa, pelo handle.
   *
   * Limitada pela mesma razao que `GET /api/invites/:code`: sem limite, isto e
   * um oraculo que diz quais handles existem, testavel em lote.
   */
  app.get('/api/users/lookup', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async req => {
    const bruto = (req.query as { username?: unknown }).username
    if (typeof bruto !== 'string') throw new AppError('validation_failed')

    const [u] = await db
      .select({ userId: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users).where(eq(users.username, normalizarUsername(bruto))).limit(1)

    if (!u) throw new AppError('not_found')
    return u
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async req => {
    const id = req.user!.id
    const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!u) throw new AppError('unauthenticated')

    const meus = await db
      .select({
        id: groups.id, name: groups.name, iconUrl: groups.iconUrl, role: groupMembers.role,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, id))

    return {
      user: {
        id: u.id, email: u.email, displayName: u.displayName, username: u.username,
        avatarUrl: u.avatarUrl, emailVerifiedAt: u.emailVerifiedAt,
      },
      groups: meus,
      // Para a tela poder dizer "2 de 3" e desabilitar o botao com um motivo,
      // em vez de deixar a pessoa clicar e levar um erro.
      groupQuota: await cotaDeGrupos(id),
    }
  })
}
