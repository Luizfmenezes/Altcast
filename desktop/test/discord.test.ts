import { afterEach, describe, it, expect } from 'vitest'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { codificar, criarClienteDoDiscord, decodificar, OP } from '../src/discord'
import type { ClienteDoDiscord } from '../src/discord'
import type { AtividadeMontada } from '../src/atividade'

/**
 * Um Discord falso, escutando num pipe (Windows) ou socket de arquivo (resto).
 *
 * Responde ao HANDSHAKE com READY e guarda tudo que recebe, que e o que o
 * teste confere. E o mesmo protocolo do Discord de verdade — so que com
 * memoria.
 */
type Dados = { cmd?: string; args?: { pid?: number; activity?: { details?: string } }; [k: string]: unknown }
type Falso = { servidor: Server; caminho: string; recebidos: Array<{ op: number; dados: Dados }>; sockets: Socket[] }

function caminhoTemporario(): string {
  const nome = `altcast-teste-${randomUUID()}`
  return process.platform === 'win32' ? `\\\\?\\pipe\\${nome}` : join(tmpdir(), `${nome}.sock`)
}

async function discordFalso(): Promise<Falso> {
  const caminho = caminhoTemporario()
  const recebidos: Falso['recebidos'] = []
  const sockets: Socket[] = []
  const servidor = createServer(s => {
    sockets.push(s)
    let acumulado: Buffer = Buffer.alloc(0)
    s.on('data', pedaco => {
      const { quadros, resto } = decodificar(Buffer.concat([acumulado, pedaco]))
      acumulado = resto
      for (const q of quadros) {
        recebidos.push({ op: q.op, dados: q.dados as Dados })
        if (q.op === OP.handshake) s.write(codificar(OP.quadro, { cmd: 'DISPATCH', evt: 'READY', data: {} }))
      }
    })
    s.on('error', () => undefined)
  })
  await new Promise<void>(r => servidor.listen(caminho, r))
  return { servidor, caminho, recebidos, sockets }
}

async function ateQue(condicao: () => boolean, ms = 2_000): Promise<void> {
  const fim = Date.now() + ms
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('condicao nao se cumpriu a tempo')
    await new Promise(r => setTimeout(r, 10))
  }
}

function atividade(clientId = '123456789012345678', details = 'Em chamada'): AtividadeMontada {
  return {
    clientId,
    atividade: {
      type: 0, details, timestamps: { start: 1 },
      assets: { large_image: 'https://x/y.png', large_text: 'Altcast' }, instance: false,
    },
  }
}

const abertos: Array<{ cliente?: ClienteDoDiscord; falso?: Falso }> = []

afterEach(async () => {
  for (const { cliente, falso } of abertos.splice(0)) {
    cliente?.encerrar()
    if (falso) {
      for (const s of falso.sockets) s.destroy()
      await new Promise(r => falso.servidor.close(r))
    }
  }
})

describe('o protocolo IPC do Discord', () => {
  it('quadro meio chegado espera o resto; dois juntos saem os dois', () => {
    const a = codificar(1, { a: 1 })
    const b = codificar(3, { b: 2 })
    const junto = Buffer.concat([a, b])
    const metade = decodificar(junto.subarray(0, a.length + 4))
    expect(metade.quadros).toEqual([{ op: 1, dados: { a: 1 } }])
    expect(metade.resto).toHaveLength(4)
    expect(decodificar(junto).quadros).toHaveLength(2)
  })
})

describe('o cliente do Rich Presence', () => {
  it('faz o handshake com o Client ID e manda a atividade depois do READY', async () => {
    const falso = await discordFalso()
    const cliente = criarClienteDoDiscord({ caminhos: () => [falso.caminho], pid: 4242, intervaloMinimoMs: 0 })
    abertos.push({ cliente, falso })

    cliente.definir(atividade())
    await ateQue(() => falso.recebidos.length >= 2)

    expect(falso.recebidos[0]).toEqual({ op: OP.handshake, dados: { v: 1, client_id: '123456789012345678' } })
    expect(falso.recebidos[1]!.op).toBe(OP.quadro)
    expect(falso.recebidos[1]!.dados.cmd).toBe('SET_ACTIVITY')
    expect(falso.recebidos[1]!.dados.args).toEqual({ pid: 4242, activity: atividade().atividade })
  })

  it('`null` limpa o cartao: SET_ACTIVITY sem `activity`', async () => {
    const falso = await discordFalso()
    const cliente = criarClienteDoDiscord({ caminhos: () => [falso.caminho], pid: 1, intervaloMinimoMs: 0 })
    abertos.push({ cliente, falso })

    cliente.definir(atividade())
    await ateQue(() => falso.recebidos.length >= 2)
    cliente.definir(null)
    await ateQue(() => falso.recebidos.length >= 3)
    expect(falso.recebidos[2]!.dados.args).toEqual({ pid: 1 })
  })

  it('mudancas em rajada viram um envio so, com a ultima', async () => {
    const falso = await discordFalso()
    const cliente = criarClienteDoDiscord({ caminhos: () => [falso.caminho], pid: 1, intervaloMinimoMs: 150 })
    abertos.push({ cliente, falso })

    cliente.definir(atividade())
    await ateQue(() => falso.recebidos.length >= 2)
    cliente.definir(atividade(undefined, 'Transmitindo a tela'))
    cliente.definir(atividade(undefined, 'Em chamada'))
    cliente.definir(atividade(undefined, 'Transmitindo a tela'))
    await ateQue(() => falso.recebidos.length >= 3)
    await new Promise(r => setTimeout(r, 250))
    expect(falso.recebidos).toHaveLength(3)
    expect(falso.recebidos[2]!.dados.args!.activity!.details).toBe('Transmitindo a tela')
  })

  /** O caso comum: o Altcast abre antes do Discord. */
  it('Discord fechado: tenta de novo e entrega quando ele abre', async () => {
    const caminho = caminhoTemporario()
    const cliente = criarClienteDoDiscord({ caminhos: () => [caminho], pid: 1, esperaMs: 50, intervaloMinimoMs: 0 })
    abertos.push({ cliente })

    cliente.definir(atividade())
    await new Promise(r => setTimeout(r, 120))

    const recebidos: number[] = []
    const servidor = createServer(s => {
      s.on('data', pedaco => {
        for (const q of decodificar(pedaco).quadros) {
          recebidos.push(q.op)
          if (q.op === OP.handshake) s.write(codificar(OP.quadro, { evt: 'READY' }))
        }
      })
      s.on('error', () => undefined)
      abertos.push({ falso: { servidor, caminho, recebidos: [], sockets: [s] } })
    })
    await new Promise<void>(r => servidor.listen(caminho, r))

    await ateQue(() => recebidos.length >= 2)
    expect(recebidos).toEqual([OP.handshake, OP.quadro])
  })

  it('responde PING com PONG, com os mesmos dados', async () => {
    const falso = await discordFalso()
    const cliente = criarClienteDoDiscord({ caminhos: () => [falso.caminho], pid: 1, intervaloMinimoMs: 0 })
    abertos.push({ cliente, falso })

    cliente.definir(atividade())
    await ateQue(() => falso.recebidos.length >= 2)
    falso.sockets[0]!.write(codificar(OP.ping, { n: 7 }))
    await ateQue(() => falso.recebidos.some(q => q.op === OP.pong))
    expect(falso.recebidos.find(q => q.op === OP.pong)!.dados).toEqual({ n: 7 })
  })
})
