import { Readable } from 'node:stream'
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { attachments, channelMembers } from '../src/db/schema.js'
import { buildServer } from '../src/index.js'
import type { Armazem } from '../src/media/armazenamento.js'

/**
 * Armazem em memoria com a mesma superficie do MinIO.
 *
 * Existe para que estes testes provem o CONTRATO — quem pode subir, quem pode
 * baixar, o que acontece com um arquivo que mente sobre o proprio tipo — sem
 * depender de um servidor de objetos de pe.
 */
class ArmazemFalso implements Armazem {
  objetos = new Map<string, { dados: Buffer; contentType: string }>()
  removidos: string[] = []

  async guardar(chave: string, dados: Buffer, contentType: string): Promise<void> {
    this.objetos.set(chave, { dados, contentType })
  }

  async ler(chave: string): Promise<Readable> {
    const o = this.objetos.get(chave)
    if (o === undefined) throw new Error(`objeto inexistente: ${chave}`)
    return Readable.from(o.dados)
  }

  async remover(chaves: string[]): Promise<void> {
    this.removidos.push(...chaves)
    for (const c of chaves) this.objetos.delete(c)
  }
}

/** PNG de 1x1 valido. Precisa ser real: o sharp le a largura de verdade. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

type App = Awaited<ReturnType<typeof buildServer>>

/** Multipart montado a mao: o inject nao tem construtor proprio para isso. */
function multipart(nome: string, dados: Buffer): {
  payload: Buffer; headers: Record<string, string>
} {
  const limite = '----altcastteste'
  const cabeca = Buffer.from(
    `--${limite}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${nome}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n',
  )
  const pe = Buffer.from(`\r\n--${limite}--\r\n`)
  return {
    payload: Buffer.concat([cabeca, dados, pe]),
    headers: { 'content-type': `multipart/form-data; boundary=${limite}` },
  }
}

async function subir(app: App, cookie: string, canalId: string, nome: string, dados: Buffer) {
  const { payload, headers } = multipart(nome, dados)
  return app.inject({
    method: 'POST', url: `/api/channels/${canalId}/attachments`,
    headers: { ...headers, cookie }, payload,
  })
}

/** O canal geral, que a criacao do grupo ja deixa pronto e publico. */
async function canalDoCenario(
  app: App, base: { groupId: string; cookieDono: string },
): Promise<string> {
  const res = await app.inject({
    method: 'GET', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
  })
  return res.json()[0].id as string
}

async function canalPrivado(app: App, base: { groupId: string; cookieDono: string }): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: `/api/groups/${base.groupId}/channels`,
    headers: { cookie: base.cookieDono },
    payload: { name: 'reservado', visibility: 'private' },
  })
  return res.json().id as string
}

describe('anexos — subir', () => {
  it('grava o arquivo, detecta o tipo e mede a imagem', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const res = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)
      expect(res.statusCode).toBe(201)
      const corpo = res.json()
      expect(corpo.contentType).toBe('image/png')
      expect(corpo.width).toBe(1)
      expect(corpo.reproduzivel).toBe(true)
      expect(corpo.temMiniatura).toBe(true)
      // O original e a miniatura: dois objetos distintos no armazem.
      expect(armazem.objetos.size).toBe(2)

      const [linha] = await db.select().from(attachments).where(eq(attachments.id, corpo.id))
      // Orfao ate a mensagem existir: e o que permite progresso e previa.
      expect(linha!.messageId).toBeNull()
      // O caminho vem do id, jamais do nome enviado.
      expect(linha!.objectKey).not.toContain('foto.png')
      await app.close()
    })
  })

  /**
   * O ponto inteiro da deteccao no servidor. Um executavel com nome de imagem
   * nao pode voltar como imagem: se voltasse, bastaria um nome bem escolhido
   * para servir conteudo executavel da nossa propria origem.
   */
  it('arquivo que mente sobre o proprio tipo vira octetos e nao renderiza', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
      const res = await subir(app, base.cookieDono, canalId, 'gatinho.png', executavel)
      expect(res.statusCode).toBe(201)
      expect(res.json().contentType).toBe('application/octet-stream')
      expect(res.json().reproduzivel).toBe(false)
      expect(res.json().temMiniatura).toBe(false)

      const baixado = await app.inject({
        method: 'GET', url: `/api/attachments/${res.json().id}`,
        headers: { cookie: base.cookieDono },
      })
      expect(baixado.headers['content-type']).toBe('application/octet-stream')
      expect(baixado.headers['content-disposition']).toContain('attachment')
      expect(baixado.headers['x-content-type-options']).toBe('nosniff')
      await app.close()
    })
  })

  it('SVG com script embutido nunca volta como imagem', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
      const res = await subir(app, base.cookieDono, canalId, 'inofensivo.svg', svg)
      // Renderizado inline, ele executaria script no contexto do site.
      expect(res.json().contentType).toBe('application/octet-stream')
      expect(res.json().reproduzivel).toBe(false)
      await app.close()
    })
  })

  it('arquivo vazio nao vira anexo', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const res = await subir(app, base.cookieDono, canalId, 'nada.bin', Buffer.alloc(0))
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  it('sem armazenamento configurado, a rota diz isso em vez de quebrar', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: null })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const res = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe('storage_unavailable')
      await app.close()
    })
  })

  it('estranho ao grupo nao sobe nada, e recebe 404', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const forasteiro = await loginComo(app, db, 'forasteiro@x.com')

      const res = await subir(app, forasteiro.cookie, canalId, 'foto.png', PNG_1X1)
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })
})

describe('anexos — quem pode baixar', () => {
  it('o anexo de canal privado devolve 404 para quem esta fora — nunca 403', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const privado = await canalPrivado(app, base)

      const res = await subir(app, base.cookieDono, privado, 'segredo.png', PNG_1X1)
      expect(res.statusCode).toBe(201)
      const anexoId = res.json().id as string

      // O admin do grupo esta FORA do canal privado. Se ele lesse o arquivo
      // por ser admin, "privado" valeria para o texto e nao para o anexo — a
      // mesma porta com duas fechaduras diferentes.
      const doAdmin = await app.inject({
        method: 'GET', url: `/api/attachments/${anexoId}`,
        headers: { cookie: base.cookieAdmin },
      })
      expect(doAdmin.statusCode).toBe(404)

      const dono = await app.inject({
        method: 'GET', url: `/api/attachments/${anexoId}`,
        headers: { cookie: base.cookieDono },
      })
      expect(dono.statusCode).toBe(200)
      await app.close()
    })
  })

  it('quem entra no canal privado depois passa a alcancar o anexo', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const privado = await canalPrivado(app, base)
      const res = await subir(app, base.cookieDono, privado, 'x.png', PNG_1X1)
      const anexoId = res.json().id as string

      const antes = await app.inject({
        method: 'GET', url: `/api/attachments/${anexoId}`,
        headers: { cookie: base.cookieAdmin },
      })
      expect(antes.statusCode).toBe(404)

      await db.insert(channelMembers).values({ channelId: privado, userId: base.adminId })

      const depois = await app.inject({
        method: 'GET', url: `/api/attachments/${anexoId}`,
        headers: { cookie: base.cookieAdmin },
      })
      // A autorizacao e lida a cada requisicao, e nao gravada no anexo.
      expect(depois.statusCode).toBe(200)
      await app.close()
    })
  })

  it('exige sessao', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const res = await subir(app, base.cookieDono, canalId, 'x.png', PNG_1X1)

      const semCookie = await app.inject({
        method: 'GET', url: `/api/attachments/${res.json().id}`,
      })
      expect(semCookie.statusCode).toBe(401)
      await app.close()
    })
  })
})

describe('anexos — presos a mensagem', () => {
  it('a mensagem prende o anexo e o devolve junto', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)
      const anexoId = anexo.json().id as string

      const msg = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono },
        payload: { content: 'olha isso', attachmentIds: [anexoId] },
      })
      expect(msg.statusCode).toBe(201)
      expect(msg.json().attachments).toHaveLength(1)
      expect(msg.json().attachments[0].id).toBe(anexoId)

      const lista = await app.inject({
        method: 'GET', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono },
      })
      expect(lista.json()[0].attachments[0].id).toBe(anexoId)
      await app.close()
    })
  })

  it('foto sem legenda e mensagem legitima', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)

      const res = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono },
        payload: { content: '', attachmentIds: [anexo.json().id] },
      })
      expect(res.statusCode).toBe(201)
      await app.close()
    })
  })

  it('sem texto e sem arquivo nao existe mensagem', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)

      const res = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: '   ' },
      })
      expect(res.statusCode).toBe(422)
      await app.close()
    })
  })

  /**
   * A regressao que importa: sem a checagem de canal em `prenderAnexos`,
   * bastaria citar o id de um anexo de canal privado ao postar num canal
   * publico para arrasta-lo para la — e a autorizacao de leitura, que olha o
   * canal do anexo, passaria a proteger o canal errado.
   */
  it('anexo de outro canal nao e arrastado para a mensagem', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const publico = await canalDoCenario(app, base)
      const privado = await canalPrivado(app, base)
      const doPrivado = await subir(app, base.cookieDono, privado, 'segredo.png', PNG_1X1)

      const msg = await app.inject({
        method: 'POST', url: `/api/channels/${publico}/messages`,
        headers: { cookie: base.cookieDono },
        payload: { content: 'nada a ver', attachmentIds: [doPrivado.json().id] },
      })
      expect(msg.statusCode).toBe(201)
      expect(msg.json().attachments).toEqual([])

      const [linha] = await db.select().from(attachments)
        .where(eq(attachments.id, doPrivado.json().id))
      // Continua orfao e continua no canal privado.
      expect(linha!.messageId).toBeNull()
      expect(linha!.channelId).toBe(privado)
      await app.close()
    })
  })

  it('o mesmo anexo nao entra em duas mensagens', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)
      const ids = [anexo.json().id]

      const primeira = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: 'a', attachmentIds: ids },
      })
      expect(primeira.json().attachments).toHaveLength(1)

      const segunda = await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono }, payload: { content: 'b', attachmentIds: ids },
      })
      // Ja tem dono: prender de novo o tiraria da primeira mensagem.
      expect(segunda.json().attachments).toEqual([])
      await app.close()
    })
  })
})

describe('anexos — descartar antes de enviar', () => {
  it('quem subiu descarta o orfao, e o objeto sai do armazem', async () => {
    await withTestDb(async db => {
      const armazem = new ArmazemFalso()
      const app = await buildServer({ armazem })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)

      const res = await app.inject({
        method: 'DELETE', url: `/api/attachments/${anexo.json().id}`,
        headers: { cookie: base.cookieDono },
      })
      expect(res.statusCode).toBe(204)
      expect(await db.select().from(attachments)).toEqual([])
      expect(armazem.objetos.size).toBe(0)
      await app.close()
    })
  })

  it('anexo ja preso a uma mensagem nao se descarta sozinho', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)
      await app.inject({
        method: 'POST', url: `/api/channels/${canalId}/messages`,
        headers: { cookie: base.cookieDono },
        payload: { content: 'com foto', attachmentIds: [anexo.json().id] },
      })

      const res = await app.inject({
        method: 'DELETE', url: `/api/attachments/${anexo.json().id}`,
        headers: { cookie: base.cookieDono },
      })
      // Apagar aqui deixaria a conversa citando um arquivo que nao existe.
      expect(res.statusCode).toBe(409)
      await app.close()
    })
  })

  it('nao se descarta o orfao de outra pessoa', async () => {
    await withTestDb(async db => {
      const app = await buildServer({ armazem: new ArmazemFalso() })
      const base = await cenarioComAdmin(app, db)
      const canalId = await canalDoCenario(app, base)
      const anexo = await subir(app, base.cookieDono, canalId, 'foto.png', PNG_1X1)

      const res = await app.inject({
        method: 'DELETE', url: `/api/attachments/${anexo.json().id}`,
        headers: { cookie: base.cookieAdmin },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })
})
