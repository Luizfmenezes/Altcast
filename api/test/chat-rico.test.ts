import { and, eq } from 'drizzle-orm'
import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { channelReads, groupMembers, mentions, messages, reactions } from '../src/db/schema.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'
import { ehEmoji, extrairMencoes } from '../src/routes/chatRico.routes.js'
import type { Database } from '../src/db/client.js'
import type { FastifyInstance } from 'fastify'

/**
 * Reacoes, respostas, mencoes e nao-lidos.
 *
 * O que estes testes protegem sao as decisoes do modelo de dados, que sao
 * invisiveis pela interface e caras de descobrir errado em producao: a chave
 * primaria que barra reacao duplicada, o `SET NULL` que impede o apagamento de
 * uma pergunta de levar junto as respostas, e o 404 — nunca 403 — que impede
 * um canal de confirmar que uma mensagem existe la dentro.
 */

type Cenario = {
  groupId: string; canalId: string
  cookieDono: string; idDono: string
  cookieMembro: string; idMembro: string
  cookieForasteiro: string
}

async function cenario(app: FastifyInstance, db: Database): Promise<Cenario> {
  const base = await cenarioComAdmin(app, db)
  const membro = await loginComo(app, db, 'membro@x.com')
  // Fora do grupo de proposito: e ele quem prova que o 404 protege o canal.
  const forasteiro = await loginComo(app, db, 'forasteiro@x.com')
  await db.insert(groupMembers).values([
    { groupId: base.groupId, userId: membro.userId, role: 'member' },
  ])

  const canais = await app.inject({
    method: 'GET', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
  })
  const canalId = canais.json()[0].id as string

  return {
    groupId: base.groupId, canalId,
    cookieDono: base.cookieDono, idDono: base.ownerId,
    cookieMembro: membro.cookie, idMembro: membro.userId,
    cookieForasteiro: forasteiro.cookie,
  }
}

const enviar = (
  app: FastifyInstance, canalId: string, cookie: string, payload: Record<string, unknown>,
) => app.inject({
  method: 'POST', url: `/api/channels/${canalId}/messages`, headers: { cookie }, payload,
})

const reagir = (app: FastifyInstance, messageId: string, cookie: string, emoji: string) =>
  app.inject({
    method: 'POST', url: `/api/messages/${messageId}/reactions`,
    headers: { cookie }, payload: { emoji },
  })

describe('reacoes', () => {
  it('reagir duas vezes com o mesmo emoji nao duplica a linha', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'oi' })).json()

      await reagir(app, msg.id as string, c.cookieMembro, '👍')
      const segunda = await reagir(app, msg.id as string, c.cookieMembro, '👍')

      // Quem garante isso e a CHAVE PRIMARIA, e nao uma consulta antes da
      // insercao: dois cliques rapidos disparam dois POSTs, e a checagem
      // previa perderia a corrida entre eles.
      expect(segunda.statusCode).toBe(204)
      const linhas = await db.select().from(reactions)
        .where(eq(reactions.messageId, msg.id as string))
      expect(linhas).toHaveLength(1)
    })
  })

  it('a mesma pessoa pode reagir com emojis diferentes', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'oi' })).json()

      await reagir(app, msg.id as string, c.cookieMembro, '👍')
      await reagir(app, msg.id as string, c.cookieMembro, '🎉')

      const linhas = await db.select().from(reactions)
        .where(eq(reactions.messageId, msg.id as string))
      expect(linhas).toHaveLength(2)
    })
  })

  it('a listagem traz as reacoes agrupadas, com quem reagiu', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'oi' })).json()
      await reagir(app, msg.id as string, c.cookieMembro, '👍')
      await reagir(app, msg.id as string, c.cookieDono, '👍')

      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${c.canalId}/messages`,
        headers: { cookie: c.cookieMembro },
      })

      // Os `userIds` vao junto, e nao so a contagem: a interface precisa saber
      // se EU reagi para destacar a minha, e a contagem sozinha obrigaria uma
      // segunda consulta so para responder isso.
      const [primeira] = lista.json() as { reactions: unknown }[]
      expect(primeira!.reactions).toEqual([
        { emoji: '👍', userIds: expect.arrayContaining([c.idMembro, c.idDono]) },
      ])
    })
  })

  it('desfazer remove so a minha reacao', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'oi' })).json()
      await reagir(app, msg.id as string, c.cookieMembro, '👍')
      await reagir(app, msg.id as string, c.cookieDono, '👍')

      const fora = await app.inject({
        method: 'DELETE',
        url: `/api/messages/${msg.id as string}/reactions/${encodeURIComponent('👍')}`,
        headers: { cookie: c.cookieMembro },
      })

      expect(fora.statusCode).toBe(204)
      const restantes = await db.select().from(reactions)
        .where(eq(reactions.messageId, msg.id as string))
      expect(restantes).toHaveLength(1)
      expect(restantes[0]!.userId).toBe(c.idDono)
    })
  })

  it('um paragrafo nao passa por emoji', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'oi' })).json()

      // Sem a guarda, a coluna `text` aceitaria um texto inteiro e a barra de
      // reacoes viraria um segundo campo de mensagem — sem limite de tamanho.
      const recusada = await reagir(
        app, msg.id as string, c.cookieMembro, 'isto aqui nao e um emoji de jeito nenhum',
      )
      // 422 e o que `validation_failed` vale neste sistema — errors.ts:5.
      expect(recusada.statusCode).toBe(422)
    })
  })

  it('quem esta fora do grupo recebe 404, e nunca 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieMembro, { content: 'segredo' })).json()

      const negada = await reagir(app, msg.id as string, c.cookieForasteiro, '👍')

      // 403 confirmaria que a mensagem existe. O status da resposta nao pode
      // ser um oraculo sobre o conteudo de um canal que a pessoa nao ve.
      expect(negada.statusCode).toBe(404)
    })
  })
})

describe('respostas', () => {
  it('a resposta sobrevive ao apagamento da mensagem citada', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const citada = (await enviar(app, c.canalId, c.cookieMembro, { content: 'pergunta' })).json()
      const resposta = (await enviar(
        app, c.canalId, c.cookieDono, { content: 'resposta', replyToId: citada.id },
      )).json()

      await app.inject({
        method: 'DELETE', url: `/api/messages/${citada.id as string}`,
        headers: { cookie: c.cookieMembro },
      })

      // `SET NULL`, jamais `CASCADE`: com cascade, apagar uma pergunta
      // apagaria em silencio todas as respostas dela. A citacao vira "mensagem
      // apagada" e a conversa continua legivel.
      const [viva] = await db.select().from(messages)
        .where(eq(messages.id, resposta.id as string))
      expect(viva).toBeDefined()
      expect(viva!.content).toBe('resposta')
    })
  })

  it('citar mensagem de outro canal e recusado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const outroCanal = await app.inject({
        method: 'POST', url: `/api/groups/${c.groupId}/channels`,
        headers: { cookie: c.cookieDono },
        payload: { name: 'outro', type: 'text', visibility: 'public' },
      })
      const alheia = (await enviar(
        app, outroCanal.json().id as string, c.cookieDono, { content: 'de la' },
      )).json()

      const recusada = await enviar(
        app, c.canalId, c.cookieMembro, { content: 'citando', replyToId: alheia.id },
      )

      // Sem esta conferencia, citar uma mensagem de um canal privado alheio
      // vazaria o texto dela na linha de citacao de um canal publico.
      expect(recusada.statusCode).toBe(422)
    })
  })
})

describe('mencoes', () => {
  it('mencao vira linha, resolvida contra o grupo certo', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      // O `displayName` do dono e a parte local do e-mail: `dono@x.com`.
      const criada = (await enviar(
        app, c.canalId, c.cookieMembro, { content: 'oi @dono, viu isso?' },
      )).json()

      const linhas = await db.select().from(mentions)
        .where(eq(mentions.messageId, criada.id as string))
      expect(linhas).toHaveLength(1)
      expect(linhas[0]!.userId).toBe(c.idDono)
    })
  })

  it('mencao a todos e coluna, e nao uma linha por pessoa', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const criada = (await enviar(
        app, c.canalId, c.cookieMembro, { content: '@todos reuniao agora' },
      )).json()

      // Um grupo de 200 pessoas geraria 200 linhas por mensagem sem nenhuma
      // informacao nova.
      expect(criada.mentionsEveryone).toBe(true)
      const linhas = await db.select().from(mentions)
        .where(eq(mentions.messageId, criada.id as string))
      expect(linhas).toEqual([])
    })
  })
})

describe('nao-lidos', () => {
  it('marcar como lido guarda o marco e o banco o mantem', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const msg = (await enviar(app, c.canalId, c.cookieDono, { content: 'ola' })).json()

      const marcou = await app.inject({
        method: 'PUT', url: `/api/channels/${c.canalId}/read`,
        headers: { cookie: c.cookieMembro }, payload: { lastReadMessageId: msg.id },
      })

      expect(marcou.statusCode).toBe(204)
      const [linha] = await db.select().from(channelReads).where(and(
        eq(channelReads.channelId, c.canalId), eq(channelReads.userId, c.idMembro),
      ))
      expect(linha!.lastReadMessageId).toBe(msg.id)
    })
  })

  it('marcar de novo atualiza em vez de estourar a chave primaria', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)
      const primeira = (await enviar(app, c.canalId, c.cookieDono, { content: 'um' })).json()
      const segunda = (await enviar(app, c.canalId, c.cookieDono, { content: 'dois' })).json()

      await app.inject({
        method: 'PUT', url: `/api/channels/${c.canalId}/read`,
        headers: { cookie: c.cookieMembro }, payload: { lastReadMessageId: primeira.id },
      })
      const denovo = await app.inject({
        method: 'PUT', url: `/api/channels/${c.canalId}/read`,
        headers: { cookie: c.cookieMembro }, payload: { lastReadMessageId: segunda.id },
      })

      expect(denovo.statusCode).toBe(204)
      const [linha] = await db.select().from(channelReads).where(and(
        eq(channelReads.channelId, c.canalId), eq(channelReads.userId, c.idMembro),
      ))
      expect(linha!.lastReadMessageId).toBe(segunda.id)
    })
  })

  it('quem esta fora do canal nao marca leitura nele', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenario(app, db)

      const negada = await app.inject({
        method: 'PUT', url: `/api/channels/${c.canalId}/read`,
        headers: { cookie: c.cookieForasteiro }, payload: { lastReadMessageId: newId() },
      })

      expect(negada.statusCode).toBe(404)
    })
  })
})

/**
 * As duas funcoes puras, testadas sem banco: elas carregam as regras mais
 * faceis de errar e mais baratas de provar isoladamente.
 */
describe('regras puras', () => {
  it('emoji aceita sequencia com juntador e recusa texto', () => {
    expect(ehEmoji('👍')).toBe(true)
    // Uma familia e uma sequencia de code points unidos por ZWJ. Contar por
    // `.length` daria treze e a recusaria sem motivo.
    expect(ehEmoji('👨‍👩‍👧')).toBe(true)
    expect(ehEmoji('oi')).toBe(false)
    expect(ehEmoji('oi 👍')).toBe(false)
    expect(ehEmoji('')).toBe(false)
    expect(ehEmoji('👍👍👍👍👍👍👍👍👍')).toBe(false)
  })

  it('o nome mais longo ganha do mais curto', () => {
    const membros = [
      { userId: 'a', displayName: 'Ana' },
      { userId: 'b', displayName: 'Ana Paula' },
    ]

    // Testar a mais curta primeiro pararia em "Ana" e deixaria " Paula"
    // solto — a mencao iria para a pessoa errada.
    expect(extrairMencoes('oi @Ana Paula', membros).userIds).toContain('b')
  })

  it('@todos e reconhecido, e "@todosaqui" nao', () => {
    expect(extrairMencoes('@todos vejam', []).todos).toBe(true)
    expect(extrairMencoes('fala com @todosaqui', []).todos).toBe(false)
  })
})
