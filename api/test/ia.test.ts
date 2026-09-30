import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin } from './helpers/fixtures.js'
import { comServidor, conectado, espere, fechado } from './helpers/ws.js'
import { channels, iaDecisoes, users } from '../src/db/schema.js'
import { circuitoAberto, definirChaveParaTeste, definirTransporteParaTeste, perguntar } from '../src/ia/cliente.js'
import { definirOrcamentoParaTeste, podeGastar, registrarGasto, zerarMemoriaParaTeste } from '../src/ia/memoria.js'
import { buildServer } from '../src/index.js'

/**
 * A camada de IA (super plano, secao 7): opt-in, caminho sem IA, dados
 * minimos. O System One nunca e chamado de verdade aqui — o transporte e um
 * duble que responde no formato documentado.
 */


function respostaScore(score: number, confidence: number, ids: string[]): Response {
  return new Response(JSON.stringify({
    model: 'jev-latest',
    answers: Object.fromEntries(ids.map(id => [id, {
      type: 'score', score, confidence, probabilities: {}, legend: {},
    }])),
    usage: { input_tokens: 10, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  definirChaveParaTeste('chave-de-teste')
  zerarMemoriaParaTeste()
})
afterEach(() => {
  definirChaveParaTeste(undefined)
  definirTransporteParaTeste(null)
})

describe('cliente do System One', () => {
  it('sem chave, nem tenta: devolve nulo (caminho sem IA)', async () => {
    definirChaveParaTeste(null)
    let chamou = false
    definirTransporteParaTeste(async () => { chamou = true; return new Response('{}') })
    expect(await perguntar({}, { a: { type: 'noul', instructions: 'x' } }, 500)).toBeNull()
    expect(chamou).toBe(false)
  })

  it('manda o contrato documentado e le as respostas', async () => {
    let enviado: Record<string, unknown> = {}
    definirTransporteParaTeste(async (_url, init) => {
      enviado = JSON.parse(String(init.body)) as Record<string, unknown>
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer chave-de-teste')
      return respostaScore(2.5, 0.8, ['a'])
    })
    const r = await perguntar({ texto: 'oi' }, { a: { type: 'score', instructions: 'x', criteria: ['0', '1'] } }, 500)
    expect(enviado).toMatchObject({ model: 'jev-latest', state: { texto: 'oi' } })
    expect(r?.respostas['a']).toMatchObject({ type: 'score', score: 2.5, confidence: 0.8 })
  })

  it('429 tenta de novo; prazo estourado devolve nulo', async () => {
    let vezes = 0
    definirTransporteParaTeste(async () => {
      vezes += 1
      return vezes === 1 ? new Response('', { status: 429 }) : respostaScore(1, 1, ['a'])
    })
    expect(await perguntar({}, { a: { type: 'noul', instructions: 'x' } }, 1000)).not.toBeNull()
    expect(vezes).toBe(2)

    definirTransporteParaTeste((_url, init) => new Promise((_ok, falha) => {
      init.signal?.addEventListener('abort', () => falha(new Error('abort')))
    }))
    expect(await perguntar({}, { a: { type: 'noul', instructions: 'x' } }, 120)).toBeNull()
  })

  it('cinco falhas abrem o disjuntor, e ninguem mais espera', async () => {
    let vezes = 0
    definirTransporteParaTeste(async () => { vezes += 1; return new Response('', { status: 500 }) })
    for (let i = 0; i < 5; i++) await perguntar({}, { a: { type: 'noul', instructions: 'x' } }, 500)
    expect(circuitoAberto()).toBe(true)
    await perguntar({}, { a: { type: 'noul', instructions: 'x' } }, 500)
    expect(vezes).toBe(5)
  })

  it('o orcamento diario por grupo fecha a torneira', () => {
    definirOrcamentoParaTeste(3)
    registrarGasto('g', 3)
    expect(podeGastar('g')).toBe(false)
    expect(podeGastar('outro')).toBe(true)
    definirOrcamentoParaTeste(undefined)
  })
})

describe('triagem "Inteligente" (secao 7.3)', () => {
  async function preparar(
    app: Awaited<ReturnType<typeof buildServer>>, db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  ) {
    const base = await cenarioComAdmin(app, db)
    const [geral] = await db.select().from(channels)
    await app.inject({
      method: 'PUT', url: `/api/groups/${base.groupId}/ai/triagem`,
      headers: { cookie: base.cookieDono }, payload: { ativo: true },
    })
    await app.inject({
      method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
      payload: { scopeType: 'channel', scopeId: geral!.id, level: 'smart', mutedUntil: null },
    })
    return { base, geral: geral! }
  }

  it('score alto avisa quem escolheu Inteligente — e o estado nao leva id nem e-mail', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { base, geral } = await preparar(app, db)
        let estado = ''
        definirTransporteParaTeste(async (_u, init) => {
          const corpo = JSON.parse(String(init.body)) as { state: unknown; questions: Record<string, unknown> }
          estado = JSON.stringify(corpo.state)
          return respostaScore(3, 0.9, Object.keys(corpo.questions))
        })
        const admin = await conectado(url, base.cookieAdmin)
        await app.inject({
          method: 'POST', url: `/api/channels/${geral.id}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'Precisamos decidir o orçamento até sexta' },
        })
        await espere(300)
        expect(admin.frames.some(f => f.t === 'attention.suggested')).toBe(true)

        const pessoas = await db.select({ id: users.id, email: users.email }).from(users)
        for (const p of pessoas) {
          expect(estado).not.toContain(p.id)
          expect(estado).not.toContain(p.email)
        }
        expect(estado).toContain('"author":"autor"')

        const [decisao] = await db.select().from(iaDecisoes)
        expect(decisao).toMatchObject({ recurso: 'triagem', versao: 'atencao.v1', acao: 'notificou:1' })
        admin.ws.close(); await fechado(admin.ws)
      })
    })
  })

  it('abaixo do limiar, ou com a IA fora do ar, ninguem e avisado', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const { base, geral } = await preparar(app, db)
        definirTransporteParaTeste(async (_u, init) => {
          const corpo = JSON.parse(String(init.body)) as { questions: Record<string, unknown> }
          return respostaScore(0.4, 0.9, Object.keys(corpo.questions))
        })
        const admin = await conectado(url, base.cookieAdmin)
        await app.inject({
          method: 'POST', url: `/api/channels/${geral.id}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'kkkk' },
        })
        // A triagem corre depois da resposta: espera ela terminar antes de
        // derrubar o transporte.
        await espere(300)
        definirTransporteParaTeste(async () => new Response('', { status: 500 }))
        await app.inject({
          method: 'POST', url: `/api/channels/${geral.id}/messages`,
          headers: { cookie: base.cookieDono }, payload: { content: 'outra' },
        })
        await espere(300)
        expect(admin.frames.some(f => f.t === 'attention.suggested')).toBe(false)
        const acoes = (await db.select().from(iaDecisoes)).map(d => d.acao).sort()
        expect(acoes).toEqual(['abaixo_do_limiar', 'sem_resposta'])
        admin.ws.close(); await fechado(admin.ws)
      })
    })
  })

  it('grupo que nao ligou o recurso nao manda nada para fora', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const [geral] = await db.select().from(channels)
      await app.inject({
        method: 'PUT', url: '/api/notification-prefs', headers: { cookie: base.cookieAdmin },
        payload: { scopeType: 'channel', scopeId: geral!.id, level: 'smart', mutedUntil: null },
      })
      let chamou = false
      definirTransporteParaTeste(async () => { chamou = true; return respostaScore(3, 1, ['x']) })
      await app.inject({
        method: 'POST', url: `/api/channels/${geral!.id}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: 'oi' },
      })
      await espere(200)
      expect(chamou).toBe(false)
      await app.close()
    })
  })

  it('so quem edita o grupo liga um recurso; todo membro ve o estado', async () => {
    await withTestDb(async db => {
      const app = await buildServer()
      const base = await cenarioComAdmin(app, db)
      const membro = await db.select().from(users).where(eq(users.id, base.adminId))
      void membro
      const ver = await app.inject({
        method: 'GET', url: `/api/groups/${base.groupId}/ai`, headers: { cookie: base.cookieAdmin },
      })
      expect(ver.json()).toMatchObject({ disponivel: true })
      expect(ver.json().recursos.find((r: { recurso: string }) => r.recurso === 'triagem').ativo).toBe(false)
      await app.close()
    })
  })
})
