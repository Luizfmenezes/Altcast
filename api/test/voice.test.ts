import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { ateQue, comServidor, conectado, espere, esperarFrame } from './helpers/ws.js'
import { groupMembers } from '../src/db/schema.js'
import { calls } from '../src/realtime/calls.js'

/**
 * A chamada nao pode abrir um caminho novo para o que o texto ja fecha. Cada
 * caso aqui e a versao em voz de uma regra que a Fatia 1 ja provava para
 * mensagem: quem nao ve o canal nao entra na sala, nao aparece na lista e nao
 * recebe evento nenhum.
 */
/** Igual ao de media-token.test.ts: o formato exato que o LiveKit le. */
type CorpoDoToken = {
  iss: string
  sub: string
  video: { room: string; canPublish: boolean; roomAdmin: boolean }
}

function corpo(token: string): CorpoDoToken {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as CorpoDoToken
}

async function criarCanal(
  app: FastifyInstance, groupId: string, cookie: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const r = await app.inject({
    method: 'POST', url: `/api/groups/${groupId}/channels`,
    headers: { cookie }, payload: campos,
  })
  expect(r.statusCode).toBe(201)
  return r.json().id as string
}

describe('chamada — credencial de entrada', () => {
  it('canal de voz publico devolve token com a sala certa', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala-de-reuniao', type: 'voice' })

        const r = await app.inject({
          method: 'POST', url: `/api/channels/${voz}/call-token`,
          headers: { cookie: base.cookieAdmin },
        })

        expect(r.statusCode).toBe(200)
        expect(r.json()).toMatchObject({
          room: voz, identity: base.adminId, url: 'ws://localhost:7880', expiresIn: 300,
        })
        const c = corpo(r.json().token as string)
        expect(c.video.room).toBe(voz)
        expect(c.sub).toBe(base.adminId)
        // Qualquer participante transmite.
        expect(c.video.canPublish).toBe(true)
      })
    })
  })

  it('quem administra recebe credencial de moderador; quem nao, nao', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const membro = await loginComo(app, db, 'membro@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: membro.userId, role: 'member' })
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala', type: 'voice' })

        const doAdmin = await app.inject({
          method: 'POST', url: `/api/channels/${voz}/call-token`,
          headers: { cookie: base.cookieAdmin },
        })
        const doMembro = await app.inject({
          method: 'POST', url: `/api/channels/${voz}/call-token`,
          headers: { cookie: membro.cookie },
        })

        expect(corpo(doAdmin.json().token as string).video.roomAdmin).toBe(true)
        expect(corpo(doMembro.json().token as string).video.roomAdmin).toBe(false)
      })
    })
  })

  it('canal de texto nao tem chamada: 422, nao token', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const texto = await criarCanal(app, base.groupId, base.cookieDono, { name: 'avisos' })

        const r = await app.inject({
          method: 'POST', url: `/api/channels/${texto}/call-token`,
          headers: { cookie: base.cookieDono },
        })
        expect(r.statusCode).toBe(422)
        expect(r.json().error.code).toBe('validation_failed')
      })
    })
  })

  it('canal de voz privado: quem esta dentro entra, quem esta fora leva 404', async () => {
    await withTestDb(async db => {
      await comServidor(async app => {
        const base = await cenarioComAdmin(app, db)
        const fora = await loginComo(app, db, 'fora@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: fora.userId, role: 'member' })
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'diretoria-voz', type: 'voice', visibility: 'private' })

        const dono = await app.inject({
          method: 'POST', url: `/api/channels/${voz}/call-token`,
          headers: { cookie: base.cookieDono },
        })
        expect(dono.statusCode).toBe(200)

        // 404, jamais 403: um 403 confirmaria que a sala existe.
        for (const cookie of [fora.cookie, base.cookieAdmin]) {
          const r = await app.inject({
            method: 'POST', url: `/api/channels/${voz}/call-token`, headers: { cookie },
          })
          expect(r.statusCode).toBe(404)
          expect(r.json().error.code).toBe('not_found')
        }
      })
    })
  })
})

describe('chamada — presenca em tempo real', () => {
  it('entrar avisa a audiencia do canal, e a pessoa entra muda', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala', type: 'voice' })

        const quemEntra = await conectado(url, base.cookieDono)
        const espectador = await conectado(url, base.cookieAdmin)

        quemEntra.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))

        const frame = await esperarFrame(espectador.frames, 'voice.participant_joined')
        expect(frame.d).toEqual({
          channelId: voz, userId: base.ownerId,
          microfone: false, camera: false, tela: false,
        })

        quemEntra.ws.close(); espectador.ws.close()
      })
    })
  })

  it('ligar o microfone vira voice.track_published para a sala', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala', type: 'voice' })

        const falante = await conectado(url, base.cookieDono)
        const ouvinte = await conectado(url, base.cookieAdmin)

        falante.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await esperarFrame(ouvinte.frames, 'voice.participant_joined')
        falante.ws.send(JSON.stringify({
          t: 'voice.state', d: { channelId: voz, microfone: true, tela: true },
        }))

        const frame = await esperarFrame(ouvinte.frames, 'voice.track_published')
        expect(frame.d).toEqual({
          channelId: voz, userId: base.ownerId,
          microfone: true, camera: false, tela: true,
        })

        falante.ws.close(); ouvinte.ws.close()
      })
    })
  })

  it('a queda do socket tira da sala e avisa', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala', type: 'voice' })

        const quemCai = await conectado(url, base.cookieDono)
        const espectador = await conectado(url, base.cookieAdmin)

        quemCai.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await esperarFrame(espectador.frames, 'voice.participant_joined')

        quemCai.ws.close()

        const saida = await esperarFrame(espectador.frames, 'voice.participant_left')
        expect(saida.d).toEqual({ channelId: voz, userId: base.ownerId })
        await ateQue(() => calls.participantes(voz).length === 0)

        espectador.ws.close()
      })
    })
  })

  it('quem chega depois recebe a sala ja povoada', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'sala', type: 'voice' })

        const primeiro = await conectado(url, base.cookieDono)
        primeiro.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await ateQue(() => calls.participantes(voz).length === 1)

        // O estado chega pela rota de token, que e o caminho que o cliente
        // percorre ao abrir a sala.
        const r = await app.inject({
          method: 'POST', url: `/api/channels/${voz}/call-token`,
          headers: { cookie: base.cookieAdmin },
        })
        expect(r.json().participants).toEqual([{
          userId: base.ownerId, microfone: false, camera: false, tela: false,
        }])

        primeiro.ws.close()
      })
    })
  })
})

describe('chamada — o que o canal privado nao deixa vazar', () => {
  it('voice.join de quem esta fora nao entra na sala nem gera evento', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const fora = await loginComo(app, db, 'fora@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: fora.userId, role: 'member' })
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'diretoria-voz', type: 'voice', visibility: 'private' })

        const dentro = await conectado(url, base.cookieDono)
        const intruso = await conectado(url, fora.cookie)

        intruso.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await espere(150)

        expect(calls.participantes(voz)).toEqual([])
        expect(dentro.frames.filter(f => f.t.startsWith('voice.'))).toEqual([])
        expect(intruso.frames.filter(f => f.t.startsWith('voice.'))).toEqual([])

        dentro.ws.close(); intruso.ws.close()
      })
    })
  })

  it('quem esta fora do canal privado nao ve quem esta na chamada dele', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const fora = await loginComo(app, db, 'fora@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: fora.userId, role: 'member' })
        const voz = await criarCanal(app, base.groupId, base.cookieDono,
          { name: 'diretoria-voz', type: 'voice', visibility: 'private' })

        const dentro = await conectado(url, base.cookieDono)
        dentro.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await ateQue(() => calls.participantes(voz).length === 1)

        const deFora = await conectado(url, fora.cookie)
        await espere(150)
        expect(deFora.frames.filter(f => f.t.startsWith('voice.'))).toEqual([])

        dentro.ws.close(); deFora.ws.close()
      })
    })
  })
})
