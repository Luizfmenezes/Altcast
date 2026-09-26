import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin } from './helpers/fixtures.js'
import { ateQue, comServidor, conectado, conectarEscutando, espere, esperarFrame } from './helpers/ws.js'
import { calls } from './../src/realtime/calls.js'

/**
 * A piscada de rede que apagava a pessoa da sala.
 *
 * O servidor tirava alguem de toda chamada no instante em que o ultimo socket
 * dela caia. A sala do LiveKit, porem, sobrevive a isso: a pessoa voltava
 * audivel para todo mundo e ausente de todas as listas, sem nada que a
 * recolocasse la. Estes casos provam a janela de graca que consertou isso.
 *
 * `VOICE_RECONNECT_GRACE_MS` e encurtado sob teste (api/vitest.config.ts): o
 * que se prova aqui e a ORDEM dos acontecimentos, nunca a duracao.
 */

/**
 * A janela, lida do ambiente em vez de repetida.
 *
 * Toda espera daqui e "a janela mais uma margem". Com o numero escrito a mao,
 * mexer na configuracao silenciosamente esvaziava as assercoes: esperar 120ms
 * depois de uma janela de 1s nao prova que o temporizador nao disparou — prova
 * apenas que ainda nao era a hora dele.
 */
const GRACA = Number(process.env['VOICE_RECONNECT_GRACE_MS'])
const DEPOIS_DA_JANELA = GRACA + 200


async function criarCanal(
  app: FastifyInstance, groupId: string, cookie: string,
): Promise<string> {
  const r = await app.inject({
    method: 'POST', url: `/api/groups/${groupId}/channels`,
    headers: { cookie },
    payload: { name: 'sala', type: 'voice' },
  })
  expect(r.statusCode).toBe(201)
  return r.json().id as string
}

describe('reconexao durante a chamada', () => {
  it('voltar dentro da janela nao emite evento nenhum', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono)

        const espectador = await conectado(url, base.cookieAdmin)
        const instavel = await conectado(url, base.cookieDono)

        instavel.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await esperarFrame(espectador.frames, 'voice.participant_joined')

        const antes = espectador.frames.length
        instavel.ws.close()

        // Volta na hora, como faz o cliente ao reconectar o WebSocket.
        const devolta = await conectarEscutando(url, base.cookieDono)
        await esperarFrame(devolta.frames, 'ready')
        await espere(DEPOIS_DA_JANELA) // passada a janela, de proposito

        // Nem `left`, nem um segundo `joined`. Para quem olha a lista, nada
        // aconteceu — e nada aconteceu mesmo.
        const novos = espectador.frames.slice(antes).filter(
          f => f.t === 'voice.participant_left' || f.t === 'voice.participant_joined',
        )
        expect(novos).toEqual([])
        expect(calls.participantes(voz)).toHaveLength(1)

        espectador.ws.close()
        devolta.ws.close()
      })
    })
  })

  it('nao voltar dentro da janela tira a pessoa da sala, uma vez so', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono)

        const espectador = await conectado(url, base.cookieAdmin)
        const quemSai = await conectado(url, base.cookieDono)

        quemSai.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await esperarFrame(espectador.frames, 'voice.participant_joined')

        quemSai.ws.close()

        const saida = await esperarFrame(espectador.frames, 'voice.participant_left')
        expect(saida.d).toEqual({ channelId: voz, userId: base.ownerId })
        await ateQue(() => calls.participantes(voz).length === 0)

        await espere(DEPOIS_DA_JANELA)
        const saidas = espectador.frames.filter(f => f.t === 'voice.participant_left')
        expect(saidas).toHaveLength(1)

        espectador.ws.close()
      })
    })
  })

  it('a segunda aba continua segurando a chamada sem graca nenhuma', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const voz = await criarCanal(app, base.groupId, base.cookieDono)

        const espectador = await conectado(url, base.cookieAdmin)
        const aba1 = await conectado(url, base.cookieDono)
        const aba2 = await conectado(url, base.cookieDono)

        aba1.ws.send(JSON.stringify({ t: 'voice.join', d: { channelId: voz } }))
        await esperarFrame(espectador.frames, 'voice.participant_joined')

        // Fechar UMA de duas abas nao e perder o socket: a presenca nao cai, e
        // portanto nem saida agendada existe.
        aba1.ws.close()
        await espere(DEPOIS_DA_JANELA)

        expect(calls.participantes(voz)).toHaveLength(1)
        expect(
          espectador.frames.filter(f => f.t === 'voice.participant_left'),
        ).toEqual([])

        espectador.ws.close()
        aba2.ws.close()
      })
    })
  })
})
