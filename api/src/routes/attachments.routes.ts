import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { db } from '../db/client.js'
import { attachments } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadChannelActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { uuidOu404 } from './groups.routes.js'
import {
  COTA_POR_CANAL, LIMITE_POR_ARQUIVO, chaveDaMiniatura, chaveDe, type Armazem,
} from '../media/armazenamento.js'
import { detectarTipo, ehReproduzivel, geraMiniatura } from '../media/tipos.js'

type Attachment = typeof attachments.$inferSelect

/** Lado maior da miniatura. Cabe na conversa sem virar uma segunda copia inteira. */
const LADO_DA_MINIATURA = 480

export function serializeAttachment(a: Attachment): Record<string, unknown> {
  return {
    id: a.id,
    channelId: a.channelId,
    messageId: a.messageId,
    filename: a.filename,
    contentType: a.contentType,
    byteSize: a.byteSize,
    width: a.width,
    height: a.height,
    temMiniatura: a.thumbKey !== null,
    // O cliente nao decide o que renderiza: quem decide e o servidor, que foi
    // quem detectou o tipo. Mandar a conclusao pronta evita que uma tela nova
    // reimplemente a regra — e a implemente diferente.
    reproduzivel: ehReproduzivel(a.contentType),
    createdAt: a.createdAt,
  }
}

/**
 * Carrega o anexo e confere que quem pede alcanca o canal dele.
 *
 * `not_found` — nunca `forbidden` — em toda recusa: um 403 aqui confirmaria a
 * existencia do arquivo para quem nao pode ve-lo, e a spec 03 secao 9 diz que
 * privado e invisivel, nao trancado.
 */
async function carregarAnexo(userId: string, id: string): Promise<Attachment> {
  const [anexo] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
  if (!anexo) throw new AppError('not_found')

  const carregado = await loadChannelActor(userId, anexo.channelId)
  if (!carregado) throw new AppError('not_found')
  assertCan(carregado.actor, 'attachment.read', {
    kind: 'channel', visibility: carregado.channel.visibility,
  })
  return anexo
}

/** Quanto o canal ja ocupa. A cota existe para um canal nao comer o disco dos outros. */
async function ocupacaoDoCanal(channelId: string): Promise<number> {
  const [linha] = await db
    .select({ total: sql<string>`coalesce(sum(${attachments.byteSize}), 0)` })
    .from(attachments).where(eq(attachments.channelId, channelId))
  return Number(linha?.total ?? 0)
}

/**
 * O cabecalho `Content-Disposition`, com o nome do arquivo dentro.
 *
 * O nome vai sempre pela forma `filename*`, percent-encoded: um nome com aspas
 * ou quebra de linha reescreveria o cabecalho inteiro se fosse interpolado cru,
 * e o nome e texto que o remetente escolheu.
 */
function disposicaoDe(contentType: string, filename: string): string {
  const modo = ehReproduzivel(contentType) ? 'inline' : 'attachment'
  return `${modo}; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function attachmentsRoutes(armazem: Armazem | null) {
  return async function registrar(app: FastifyInstance): Promise<void> {
    /** Sem armazenamento configurado a rota diz isso — e nao "algo deu errado". */
    function exigirArmazem(): Armazem {
      if (armazem === null) throw new AppError('storage_unavailable')
      return armazem
    }

    app.post('/api/channels/:id/attachments', { preHandler: requireAuth }, async (req, reply) => {
      const channelId = uuidOu404((req.params as { id: string }).id)
      const userId = req.user!.id
      const guarda = exigirArmazem()

      const carregado = await loadChannelActor(userId, channelId)
      if (!carregado) throw new AppError('not_found')
      assertCan(carregado.actor, 'message.attach', {
        kind: 'channel', visibility: carregado.channel.visibility,
      })

      const arquivo = await req.file({ limits: { fileSize: LIMITE_POR_ARQUIVO } })
      if (arquivo === undefined) throw new AppError('validation_failed')

      const dados = await arquivo.toBuffer()
      // `truncated` fica ligado quando o multipart cortou no limite. Sem esta
      // checagem o arquivo entraria pela metade, e isso so seria descoberto
      // quando alguem tentasse abri-lo.
      if (arquivo.file.truncated || dados.length > LIMITE_POR_ARQUIVO) {
        throw new AppError('file_too_large')
      }
      if (dados.length === 0) throw new AppError('validation_failed')

      if (await ocupacaoDoCanal(channelId) + dados.length > COTA_POR_CANAL) {
        throw new AppError('quota_exceeded')
      }

      // O tipo REAL, lido dos bytes. O que o cliente declarou no multipart nao
      // participa da decisao — e texto que o remetente escolhe.
      const contentType = detectarTipo(dados)

      const id = newId()
      const objectKey = chaveDe(id)
      let width: number | null = null
      let height: number | null = null
      let thumbKey: string | null = null

      if (geraMiniatura(contentType)) {
        try {
          const meta = await sharp(dados).metadata()
          width = meta.width ?? null
          height = meta.height ?? null

          const miniatura = await sharp(dados)
            .resize(LADO_DA_MINIATURA, LADO_DA_MINIATURA, {
              fit: 'inside', withoutEnlargement: true,
            })
            .webp({ quality: 78 })
            .toBuffer()
          thumbKey = chaveDaMiniatura(id)
          await guarda.guardar(thumbKey, miniatura, 'image/webp')
        } catch {
          // Imagem corrompida, ou um formato que o sharp recusa. O arquivo
          // original continua valendo: perder a miniatura degrada a aparencia,
          // e perder o upload perderia o que a pessoa quis mandar.
          thumbKey = null
        }
      }

      await guarda.guardar(objectKey, dados, contentType)

      const [criado] = await db.insert(attachments).values({
        id,
        channelId,
        uploaderId: userId,
        objectKey,
        // O nome original e ROTULO, nunca caminho: `objectKey` vem do id.
        filename: arquivo.filename.slice(0, 255),
        contentType,
        byteSize: dados.length,
        width,
        height,
        thumbKey,
      }).returning()

      return reply.status(201).send(serializeAttachment(criado!))
    })

    app.get('/api/attachments/:id', { preHandler: requireAuth }, async (req, reply) => {
      const anexo = await carregarAnexo(req.user!.id, uuidOu404((req.params as { id: string }).id))
      const corpo = await exigirArmazem().ler(anexo.objectKey)

      return reply
        .header('Content-Type', anexo.contentType)
        // Sem isto, o navegador ainda poderia adivinhar o tipo pelo conteudo e
        // desfazer a deteccao que o servidor fez de proposito.
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Length', String(anexo.byteSize))
        .header('Content-Disposition', disposicaoDe(anexo.contentType, anexo.filename))
        // Privado: o anexo herda o segredo do canal, e um proxy compartilhado
        // que guardasse esta resposta a entregaria a quem nao pode ve-la.
        .header('Cache-Control', 'private, max-age=86400')
        .send(corpo)
    })

    app.get('/api/attachments/:id/miniatura', { preHandler: requireAuth }, async (req, reply) => {
      const anexo = await carregarAnexo(req.user!.id, uuidOu404((req.params as { id: string }).id))
      if (anexo.thumbKey === null) throw new AppError('not_found')

      return reply
        .header('Content-Type', 'image/webp')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=86400')
        .send(await exigirArmazem().ler(anexo.thumbKey))
    })

    /**
     * Descartar um anexo antes de enviar a mensagem.
     *
     * So vale enquanto o anexo for orfao: depois de preso a uma mensagem, quem
     * manda e o apagamento da mensagem. Apagar o arquivo de uma mensagem viva
     * deixaria a conversa citando algo que nao existe mais.
     */
    app.delete('/api/attachments/:id', { preHandler: requireAuth }, async (req, reply) => {
      const id = uuidOu404((req.params as { id: string }).id)
      const userId = req.user!.id
      const anexo = await carregarAnexo(userId, id)

      if (anexo.messageId !== null) throw new AppError('attachment_in_use')
      // Quem subiu e quem descarta. Devolve 404 e nao 403 pelo mesmo motivo de
      // sempre: nao confirmar a existencia do arquivo para quem nao e dono.
      if (anexo.uploaderId !== userId) throw new AppError('not_found')

      // O banco primeiro: um objeto orfao no storage e desperdicio de disco,
      // enquanto uma linha apontando para objeto inexistente e um erro na cara
      // de quem le a conversa.
      await db.delete(attachments).where(eq(attachments.id, id))
      const chaves = [anexo.objectKey, ...(anexo.thumbKey === null ? [] : [anexo.thumbKey])]
      try {
        await exigirArmazem().remover(chaves)
      } catch {
        // A faxina periodica pega o que sobrou. Falhar aqui devolveria erro
        // para uma acao que, do ponto de vista de quem clicou, ja funcionou.
      }
      return reply.status(204).send()
    })
  }
}

/**
 * Prende os anexos a mensagem recem-criada.
 *
 * Aceita apenas anexo do MESMO canal e ainda orfao. Sem as duas condicoes,
 * bastaria citar o id de um anexo alheio para trazer um arquivo de canal
 * privado para dentro de um canal publico — e a autorizacao de leitura, que
 * olha o canal do anexo, passaria a proteger o canal errado.
 */
export async function prenderAnexos(
  messageId: string, channelId: string, ids: string[],
): Promise<Attachment[]> {
  if (ids.length === 0) return []
  return db.update(attachments)
    .set({ messageId })
    .where(and(
      eq(attachments.channelId, channelId),
      isNull(attachments.messageId),
      sql`${attachments.id} = any(${sql.param(ids)}::uuid[])`,
    ))
    .returning()
}

/** Os anexos de uma pagina inteira de mensagens, em uma consulta so. */
export async function anexosDe(messageIds: string[]): Promise<Map<string, Attachment[]>> {
  const mapa = new Map<string, Attachment[]>()
  if (messageIds.length === 0) return mapa

  const linhas = await db.select().from(attachments)
    .where(sql`${attachments.messageId} = any(${sql.param(messageIds)}::uuid[])`)

  for (const linha of linhas) {
    const atual = mapa.get(linha.messageId!) ?? []
    atual.push(linha)
    mapa.set(linha.messageId!, atual)
  }
  return mapa
}
