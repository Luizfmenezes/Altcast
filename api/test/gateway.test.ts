import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { comServidor, conectar, espere, fechado, primeiroFrame } from './helpers/ws.js'
import { registry } from '../src/realtime/registry.js'

describe('gateway', () => {
  it('recusa upgrade sem cookie de sessao', async () => {
    await withTestDb(async () => {
      await comServidor(async (_app, url) => {
        await expect(conectar(url)).rejects.toThrow('status 401')
        expect(registry.userIds()).toHaveLength(0)
      })
    })
  })

  it('aceita com cookie valido e envia ready', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { cookieDono, groupId } = await cenarioComAdmin(app, db)
        const ws = await conectar(url, cookieDono)
        const frame = await primeiroFrame(ws)

        expect(frame.t).toBe('ready')
        const d = frame.d as {
          user: { id: string }
          groups: { id: string }[]
          channels: { name: string }[]
          members: { userId: string }[]
          serverTime: string
        }
        expect(d.groups.map(g => g.id)).toEqual([groupId])
        expect(d.channels.map(c => c.name)).toEqual(['geral'])
        expect(d.members).toHaveLength(2)
        expect(d.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)

        ws.close()
        await fechado(ws)
      })
    })
  })

  it('o ready nao revela canal privado de quem nao participa', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const criado = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/channels`,
          headers: { cookie: base.cookieDono },
          payload: { name: 'diretoria', visibility: 'private' },
        })
        const privado = criado.json().id as string

        const ws = await conectar(url, base.cookieAdmin)
        const frame = await primeiroFrame(ws)
        expect(JSON.stringify(frame)).not.toContain(privado)
        expect(JSON.stringify(frame)).not.toContain('diretoria')

        ws.close()
        await fechado(ws)
      })
    })
  })

  it('descarta frame de tipo desconhecido sem derrubar', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { cookieDono } = await cenarioComAdmin(app, db)
        const ws = await conectar(url, cookieDono)
        await primeiroFrame(ws)

        // Se um dia alguem acrescentar um caminho de escrita pelo WebSocket,
        // este teste quebra. Spec 04 secao 2: toda mutacao e HTTP.
        ws.send(JSON.stringify({ t: 'message.create', d: { content: 'nao' } }))
        ws.send('isto nem e json')
        await espere(150)

        expect(ws.readyState).toBe(WebSocket.OPEN)
        ws.close()
        await fechado(ws)
      })
    })
  })

  it('derruba a conexao mais antiga na sexta aba', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { cookieDono, ownerId } = await cenarioComAdmin(app, db)

        const abas: WebSocket[] = []
        for (let i = 0; i < 5; i++) {
          const ws = await conectar(url, cookieDono)
          await primeiroFrame(ws)
          abas.push(ws)
        }
        expect(registry.connectionsOf(ownerId)).toBe(5)

        const sexta = await conectar(url, cookieDono)
        await primeiroFrame(sexta)
        await fechado(abas[0]!)

        expect(abas[0]!.readyState).toBe(WebSocket.CLOSED)
        expect(registry.connectionsOf(ownerId)).toBe(5)

        for (const ws of abas.slice(1)) ws.close()
        sexta.close()
      })
    })
  })

  it('sessao revogada nao consegue reconectar', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { cookie } = await loginComo(app, db, 'sai@x.com')
        const ws = await conectar(url, cookie)
        await primeiroFrame(ws)
        ws.close()
        await fechado(ws)

        await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
        await expect(conectar(url, cookie)).rejects.toThrow('status 401')
      })
    })
  })
})

describe('registro de conexoes', () => {
  /** Socket falso: o heartbeat so precisa de ping, terminate e readyState. */
  function socketFalso() {
    return {
      readyState: 1, pings: 0, encerrado: false,
      ping() { this.pings++ },
      terminate() { this.encerrado = true; this.readyState = 3 },
      send() { /* nada */ },
      close() { this.readyState = 3 },
    }
  }

  it('encerra conexao que nao responde ao ping', () => {
    registry.clear()
    const s = socketFalso()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry.add('u1', s as any)

    // Primeiro ciclo: marca como suspeita e pergunta.
    registry.heartbeat()
    expect(s.pings).toBe(1)
    expect(s.encerrado).toBe(false)

    // Segundo ciclo sem pong: a conexao morreu ha 60s e sai do registro.
    registry.heartbeat()
    expect(s.encerrado).toBe(true)
    expect(registry.userIds()).toHaveLength(0)
    registry.clear()
  })

  it('pong mantem a conexao viva indefinidamente', () => {
    registry.clear()
    const s = socketFalso()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = registry.add('u1', s as any)

    for (let ciclo = 0; ciclo < 5; ciclo++) {
      registry.heartbeat()
      registry.markAlive(id)
    }
    expect(s.encerrado).toBe(false)
    expect(registry.userIds()).toEqual(['u1'])
    registry.clear()
  })

  it('socketsOf ignora usuario sem conexao e nao repete socket', () => {
    registry.clear()
    const a = socketFalso()
    const b = socketFalso()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry.add('u1', a as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry.add('u1', b as any)

    expect(registry.socketsOf(['u1', 'ausente'])).toHaveLength(2)
    expect(registry.socketsOf([])).toHaveLength(0)
    registry.clear()
  })
})
