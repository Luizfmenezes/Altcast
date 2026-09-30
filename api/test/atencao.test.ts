import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, cenarioPrivado } from './helpers/fixtures.js'
import { comServidor, conectado, conectarEscutando, esperarFrame, espere, fechado } from './helpers/ws.js'
import { channelReads, channels, mentions, messages } from '../src/db/schema.js'
import { naoLidasPorCanal, TETO_DE_NAO_LIDAS } from '../src/atencao/naoLidas.js'
import { newId } from '../src/shared/ids.js'
import { buildServer } from '../src/index.js'
import type { Database } from '../src/db/client.js'
import { createSession } from '../src/auth/session.js'
import { env } from '../src/env.js'
import type { Frame } from './helpers/ws.js'
import { ateQue } from './helpers/ws.js'

/** As contas de `cenarioPrivado` nao tem senha: a sessao nasce direto no banco. */
async function sessaoDe(userId: string): Promise<string> {
  const s = await createSession(userId, { userAgent: null, ip: null })
  return `${env.SESSION_COOKIE_NAME}=${s.id}`
}

/** O primeiro `presence.update` com este status — a chegada tambem e um. */
async function avisoDe(frames: Frame[], userId: string, status: string): Promise<Frame> {
  let achado: Frame | undefined
  await ateQue(() => {
    achado = frames.find(f => f.t === 'presence.update'
      && f.d['userId'] === userId && f.d['status'] === status)
    return achado !== undefined
  })
  return achado!
}

/**
 * Etapa 2 do super plano: nao lidas no servidor, preferencias de notificacao e
 * status de presenca.
 */

async function escrever(
  db: Database, channelId: string, authorId: string, extras: Partial<typeof messages.$inferInsert> = {},
): Promise<string> {
  const id = newId()
  await db.insert(messages).values({ id, channelId, authorId, content: 'oi', ...extras })
  // UUIDv7 ordena por milissegundo: o intervalo garante que a proxima vem depois.
  await espere(2)
  return id
}

describe('nao lidas no servidor (D3-C)', () => {
  it('conta depois do marco, sem as proprias e sem as apagadas', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      const marco = await escrever(db, c.canalPublico, c.owner)
      await db.insert(channelReads).values({
        channelId: c.canalPublico, userId: c.membroFora, lastReadMessageId: marco,
      })
      await escrever(db, c.canalPublico, c.owner)
      await escrever(db, c.canalPublico, c.admin)
      await escrever(db, c.canalPublico, c.membroFora) // a propria nao conta
      await escrever(db, c.canalPublico, c.owner, { deletedAt: new Date() }) // apagada nao conta

      const r = await naoLidasPorCanal(c.membroFora, [c.canalPublico])
      expect(r[c.canalPublico]).toEqual({ n: 2, mentions: 0 })
    })
  })

  it('tem teto de 100, e o custo nao cresce com o canal', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      await db.insert(messages).values(Array.from({ length: TETO_DE_NAO_LIDAS + 30 }, () => ({
        id: newId(), channelId: c.canalPublico, authorId: c.owner, content: 'x',
      })))
      const r = await naoLidasPorCanal(c.membroFora, [c.canalPublico])
      expect(r[c.canalPublico]?.n).toBe(TETO_DE_NAO_LIDAS)
    })
  })

  it('conta mencoes diretas e @todos', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      const direta = await escrever(db, c.canalPublico, c.owner)
      await db.insert(mentions).values({ messageId: direta, userId: c.membroFora })
      await escrever(db, c.canalPublico, c.owner, { mentionsEveryone: true })
      await escrever(db, c.canalPublico, c.owner)

      const r = await naoLidasPorCanal(c.membroFora, [c.canalPublico])
      expect(r[c.canalPublico]).toEqual({ n: 3, mentions: 2 })
    })
  })

  it('canal nunca aberto conta so o que veio depois da entrada no grupo', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      // Mensagem "antiga": criada antes de a pessoa entrar.
      await db.insert(messages).values({
        id: newId(), channelId: c.canalPublico, authorId: c.owner, content: 'antes',
        createdAt: new Date(Date.now() - 86_400_000),
      })
      await escrever(db, c.canalPublico, c.owner)
      const r = await naoLidasPorCanal(c.membroFora, [c.canalPublico])
      expect(r[c.canalPublico]?.n).toBe(1)
    })
  })

  it('o ready traz as contagens e nunca a de um canal privado alheio', async () => {
    await withTestDb(async db => {
      const c = await cenarioPrivado(db)
      await escrever(db, c.canal, c.membroDentro)
      await escrever(db, c.canalPublico, c.owner)
      await comServidor(async (app, url) => {
        void app
        const { ws, frames } = await conectarEscutando(url, await sessaoDe(c.membroFora))
        const ready = await esperarFrame(frames, 'ready')
        const unread = ready.d['unread'] as Record<string, unknown>
        expect(unread[c.canalPublico]).toEqual({ n: 1, mentions: 0 })
        expect(JSON.stringify(ready.d)).not.toContain(c.canal)
        ws.close()
        await fechado(ws)
      })
    })
  })

  it('ler numa aba avisa as outras abas da mesma pessoa', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const [geral] = await db.select().from(channels)
        const envio = await app.inject({
          method: 'POST', url: `/api/channels/${geral!.id}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'oi admin' },
        })
        const msg = envio.json().id as string

        const { ws, frames } = await conectado(url, base.cookieAdmin)
        await app.inject({
          method: 'PUT', url: `/api/channels/${geral!.id}/read`,
          headers: { cookie: base.cookieAdmin }, payload: { lastReadMessageId: msg },
        })
        const aviso = await esperarFrame(frames, 'unread.update')
        expect(aviso.d).toEqual({ channelId: geral!.id, lastReadMessageId: msg, n: 0, mentions: 0 })
        ws.close()
        await fechado(ws)
      })
    })
  })
})

describe('preferencias de notificacao', () => {
  it('silenciar um canal grava, lista e desfazer apaga a linha', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const [geral] = await db.select().from(channels)
      const ate = new Date(Date.now() + 3_600_000).toISOString()

      const gravou = await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
        payload: { scopeType: 'channel', scopeId: geral!.id, level: null, mutedUntil: ate },
      })
      expect(gravou.statusCode).toBe(200)
      expect(gravou.json()).toMatchObject({ scopeType: 'channel', scopeId: geral!.id, level: null })

      const nivel = await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
        payload: { scopeType: 'group', scopeId: base.groupId, level: 'mentions', mutedUntil: null },
      })
      expect(nivel.json()).toMatchObject({ scopeType: 'group', level: 'mentions' })

      const lista = await app.inject({
        method: 'GET', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
      })
      expect(lista.json()).toHaveLength(2)

      // Nivel nulo e sem silencio: volta a herdar, e a linha some.
      await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
        payload: { scopeType: 'channel', scopeId: geral!.id, level: null, mutedUntil: null },
      })
      const depois = await app.inject({
        method: 'GET', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
      })
      expect(depois.json()).toHaveLength(1)
      await app.close()
    })
  })

  it('dois cliques rapidos nao criam duas linhas', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      await Promise.all(Array.from({ length: 5 }, () => app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
        payload: { scopeType: 'group', scopeId: base.groupId, level: 'none', mutedUntil: null },
      })))
      const lista = await app.inject({
        method: 'GET', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
      })
      expect(lista.json()).toHaveLength(1)
      await app.close()
    })
  })

  it('canal privado alheio e grupo alheio respondem 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const c = await cenarioPrivado(db)
      const cookie = await sessaoDe(c.membroFora)
      const privado = await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie },
        payload: { scopeType: 'channel', scopeId: c.canal, level: 'none', mutedUntil: null },
      })
      expect(privado.statusCode).toBe(404)
      const alheio = await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie },
        payload: { scopeType: 'group', scopeId: newId(), level: 'none', mutedUntil: null },
      })
      expect(alheio.statusCode).toBe(404)
      await app.close()
    })
  })
})

describe('status de presenca', () => {
  it('ficar invisivel aparece como offline para os outros', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const dono = await conectado(url, base.cookieDono)
        const admin = await conectado(url, base.cookieAdmin)

        const r = await app.inject({
          method: 'PUT', url: '/api/auth/me/status', headers: { cookie: base.cookieAdmin },
          payload: { status: 'invisible' },
        })
        expect(r.statusCode).toBe(200)
        expect(r.json().status).toBe('invisible')

        await avisoDe(dono.frames, base.adminId, 'offline')
        // E a propria pessoa se ve invisivel, em todas as abas.
        const proprio = await esperarFrame(admin.frames, 'user.status')
        expect(proprio.d).toMatchObject({ status: 'invisible' })

        // Um ready novo do dono tambem a mostra offline.
        const outro = await conectarEscutando(url, base.cookieDono)
        const ready = await esperarFrame(outro.frames, 'ready')
        const membros = ready.d['members'] as { userId: string; status: string }[]
        expect(membros.find(m => m.userId === base.adminId)?.status).toBe('offline')

        for (const s of [dono.ws, admin.ws, outro.ws]) { s.close(); await fechado(s) }
      })
    })
  })

  it('nao perturbe aparece como tal, com a frase do status', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const dono = await conectado(url, base.cookieDono)
        const admin = await conectado(url, base.cookieAdmin)
        await app.inject({
          method: 'PUT', url: '/api/auth/me/status', headers: { cookie: base.cookieAdmin },
          payload: { status: 'dnd', text: 'Em reunião', emoji: '📅' },
        })
        const aviso = await avisoDe(dono.frames, base.adminId, 'dnd')
        expect(aviso.d).toMatchObject({ statusText: 'Em reunião', statusEmoji: '📅' })
        for (const s of [dono.ws, admin.ws]) { s.close(); await fechado(s) }
      })
    })
  })

  it('o cliente avisa que ficou sem uso, e os pares o veem ausente', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const dono = await conectado(url, base.cookieDono)
        const admin = await conectado(url, base.cookieAdmin)
        admin.ws.send(JSON.stringify({ t: 'presence.idle', d: { idle: true } }))
        await avisoDe(dono.frames, base.adminId, 'idle')
        for (const s of [dono.ws, admin.ws]) { s.close(); await fechado(s) }
      })
    })
  })

  it('prazo vencido volta sozinho para online', async () => {
    const { statusEfetivo } = await import('../src/realtime/status.js')
    expect(statusEfetivo('dnd', new Date(Date.now() - 1000))).toBe('online')
    expect(statusEfetivo('dnd', new Date(Date.now() + 60_000))).toBe('dnd')
    expect(statusEfetivo('invisible', null)).toBe('invisible')
  })
})
