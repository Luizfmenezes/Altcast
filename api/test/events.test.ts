import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import {
  ateQue, comServidor, conectado, conectar, espere, esperarFrame, fechado, primeiroFrame,
} from './helpers/ws.js'
import type { Frame } from './helpers/ws.js'
import { groupMembers } from '../src/db/schema.js'
import { presence } from '../src/realtime/presence.js'

describe('eventos de tempo real', () => {
  it('POST de mensagem entrega message.created a todos do canal', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const canais = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
        })
        const canalId = canais.json()[0].id as string

        const autor = await conectado(url, base.cookieDono)
        const outro = await conectado(url, base.cookieAdmin)

        const enviada = await app.inject({
          method: 'POST', url: `/api/channels/${canalId}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'ola a todos' },
        })
        expect(enviada.statusCode).toBe(201)

        // O autor tambem recebe: o eco otimista dele e reconciliado pelo mesmo
        // ID, e assim uma segunda aba do proprio autor fica em dia.
        for (const lado of [autor, outro]) {
          const frame = await esperarFrame(lado.frames, 'message.created')
          expect(frame.d).toMatchObject({ id: enviada.json().id, content: 'ola a todos' })
        }

        autor.ws.close(); outro.ws.close()
      })
    })
  })

  it('em canal privado, socket de fora nao recebe nada', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const criado = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'diretoria', visibility: 'private' },
        })
        const privado = criado.json().id as string

        const dentro = await conectado(url, base.cookieDono)
        const fora = await conectado(url, base.cookieAdmin)

        await app.inject({
          method: 'POST', url: `/api/channels/${privado}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'sigiloso' },
        })

        await esperarFrame(dentro.frames, 'message.created')
        await espere(300)
        // Nem o evento, nem o ID do canal, nem o conteudo: para quem esta de
        // fora o canal privado nao existe nem no trafego.
        expect(fora.frames.filter(f => f.t.startsWith('message.'))).toHaveLength(0)
        expect(JSON.stringify(fora.frames)).not.toContain(privado)
        expect(JSON.stringify(fora.frames)).not.toContain('sigiloso')

        dentro.ws.close(); fora.ws.close()
      })
    })
  })

  it('adicionar ao canal privado emite channel.created so para o adicionado', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const membro = await loginComo(app, db, 'membro@x.com')
        const terceiro = await loginComo(app, db, 'terceiro@x.com')
        await db.insert(groupMembers).values([
          { groupId: base.groupId, userId: membro.userId, role: 'member' },
          { groupId: base.groupId, userId: terceiro.userId, role: 'member' },
        ])

        const criado = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'diretoria', visibility: 'private' },
        })
        const privado = criado.json().id as string

        const adicionado = await conectado(url, membro.cookie)
        const alheio = await conectado(url, terceiro.cookie)

        await app.inject({
          method: 'POST', url: `/api/channels/${privado}/members`,
          headers: { cookie: base.cookieDono }, payload: { userId: membro.userId },
        })

        const frame = await esperarFrame(adicionado.frames, 'channel.created')
        expect(frame.d).toMatchObject({ id: privado, name: 'diretoria' })
        await espere(300)
        expect(alheio.frames.filter(f => f.t.startsWith('channel.'))).toHaveLength(0)
        expect(JSON.stringify(alheio.frames)).not.toContain(privado)

        adicionado.ws.close(); alheio.ws.close()
      })
    })
  })

  it('remover do canal privado emite channel.deleted so para o removido', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const membro = await loginComo(app, db, 'membro@x.com')
        await db.insert(groupMembers)
          .values({ groupId: base.groupId, userId: membro.userId, role: 'member' })

        const criado = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'diretoria', visibility: 'private' },
        })
        const privado = criado.json().id as string
        await app.inject({
          method: 'POST', url: `/api/channels/${privado}/members`,
          headers: { cookie: base.cookieDono }, payload: { userId: membro.userId },
        })

        const removido = await conectado(url, membro.cookie)
        const dono = await conectado(url, base.cookieDono)

        await app.inject({
          method: 'DELETE', url: `/api/channels/${privado}/members/${membro.userId}`,
          headers: { cookie: base.cookieDono },
        })

        const frame = await esperarFrame(removido.frames, 'channel.deleted')
        expect(frame.d).toMatchObject({ id: privado })
        await espere(300)
        expect(dono.frames.filter(f => f.t === 'channel.deleted')).toHaveLength(0)

        removido.ws.close(); dono.ws.close()
      })
    })
  })

  it('apagar o canal avisa a audiencia que existia antes de apagar', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const canais = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
        })
        const canalId = canais.json()[0].id as string

        const admin = await conectado(url, base.cookieAdmin)
        await app.inject({
          method: 'DELETE', url: `/api/channels/${canalId}`,
          headers: { cookie: base.cookieDono },
        })

        const frame = await esperarFrame(admin.frames, 'channel.deleted')
        expect(frame.d).toMatchObject({ id: canalId })
        admin.ws.close()
      })
    })
  })

  it('presenca so muda na primeira e na ultima conexao', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const observador = await conectado(url, base.cookieAdmin)

        /** So o que fala do dono: o observador tambem recebe a propria presenca. */
        const doDono = (): Frame[] => observador.frames.filter(
          f => f.t === 'presence.update' && f.d.userId === base.ownerId,
        )

        const aba1 = await conectar(url, base.cookieDono)
        await primeiroFrame(aba1)
        await ateQue(() => doDono().length === 1)
        expect(doDono()[0]!.d).toMatchObject({ status: 'online' })
        expect(presence.isOnline(base.ownerId)).toBe(true)

        // Segunda aba do mesmo usuario: ninguem ficou online de novo.
        const aba2 = await conectar(url, base.cookieDono)
        await primeiroFrame(aba2)
        await espere(300)
        expect(doDono()).toHaveLength(1)

        // Fechar uma das duas tambem nao muda nada: ele continua conectado.
        aba1.close()
        await fechado(aba1)
        await espere(300)
        expect(doDono()).toHaveLength(1)
        expect(presence.isOnline(base.ownerId)).toBe(true)

        aba2.close()
        await fechado(aba2)
        await espere(300)
        expect(doDono()).toHaveLength(2)
        expect(doDono()[1]!.d).toMatchObject({ status: 'offline' })
        expect(presence.isOnline(base.ownerId)).toBe(false)

        observador.ws.close()
      })
    })
  })

  it('presence.update vai so para quem compartilha grupo', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const estranho = await loginComo(app, db, 'estranho@x.com')

        const deFora = await conectado(url, estranho.cookie)
        const doGrupo = await conectado(url, base.cookieAdmin)

        const nova = await conectar(url, base.cookieDono)
        await primeiroFrame(nova)

        await esperarFrame(doGrupo.frames, 'presence.update')
        // O estranho nao divide grupo com ninguem: nem a propria presenca lhe
        // volta, porque a audiencia dele e so ele mesmo e ele ja sabe.
        expect(deFora.frames.filter(f => f.d.userId === base.ownerId)).toHaveLength(0)

        nova.close(); deFora.ws.close(); doGrupo.ws.close()
      })
    })
  })

  it('typing e repassado a audiencia do canal, menos o autor', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const canais = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
        })
        const canalId = canais.json()[0].id as string

        const autor = await conectado(url, base.cookieDono)
        const outro = await conectado(url, base.cookieAdmin)

        autor.ws.send(JSON.stringify({ t: 'typing', d: { channelId: canalId } }))

        const frame = await esperarFrame(outro.frames, 'typing.start')
        expect(frame.d).toMatchObject({ channelId: canalId, userId: base.ownerId })
        expect(autor.frames.filter(f => f.t === 'typing.start')).toHaveLength(0)

        autor.ws.close(); outro.ws.close()
      })
    })
  })

  it('entrar por convite avisa o grupo com member.joined', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const dentro = await conectado(url, base.cookieDono)

        const convite = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/invites`,
          headers: { cookie: base.cookieDono }, payload: {},
        })
        const code = convite.json().code as string

        const entrando = await loginComo(app, db, 'novo@x.com')
        const aceite = await app.inject({
          method: 'POST', url: `/api/invites/${code}/accept`,
          headers: { cookie: entrando.cookie },
        })
        expect(aceite.statusCode).toBe(200)

        const frame = await esperarFrame(dentro.frames, 'member.joined')
        // O nome vai junto: sem ele a lista de membros desenharia uma linha
        // vazia ate cada cliente buscar o nome por conta propria.
        expect(frame.d).toMatchObject({
          groupId: base.groupId, userId: entrando.userId, displayName: 'novo', role: 'member',
        })
        dentro.ws.close()
      })
    })
  })

  it('emitir para socket ja fechado nao derruba a rota', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const canais = await app.inject({
          method: 'GET', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
        })
        const canalId = canais.json()[0].id as string

        const ws = await conectar(url, base.cookieDono)
        await primeiroFrame(ws)
        ws.terminate()
        await espere(100)

        const res = await app.inject({
          method: 'POST', url: `/api/channels/${canalId}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'no vazio' },
        })
        expect(res.statusCode).toBe(201)
        expect(ws.readyState).toBe(WebSocket.CLOSED)
      })
    })
  })
})
