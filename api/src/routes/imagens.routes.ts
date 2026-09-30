import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db/client.js'
import { groups, users } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { assertCan, loadGroupActor } from '../permissions/context.js'
import { AppError } from '../shared/errors.js'
import { newId } from '../shared/ids.js'
import { emit } from '../realtime/emit.js'
import { emitirGrupoAtualizado } from '../groups/eventos.js'
import { uuidOu404 } from './groups.routes.js'
import {
  chaveDoAvatar, chaveDoBanner, chaveDoIcone, type Armazem,
} from '../media/armazenamento.js'
import {
  BANNER, LADO_DO_AVATAR, LADO_DO_ICONE, LIMITE_DE_IMAGEM, normalizarImagem,
} from '../media/imagem.js'

/**
 * Avatar de pessoa e icone de grupo, com bytes nossos por tras.
 *
 * Ate aqui as duas coisas eram um endereco de texto que alguem digitava — o
 * que na pratica significava que ninguem tinha foto, porque ninguem hospeda
 * uma imagem em algum lugar so para cola-la aqui.
 *
 * ## Por que a URL nao contem o id do recurso
 *
 * A imagem e servida em `/api/avatars/:mediaId`, com um UUIDv7 NOVO por
 * upload, e nao em `/api/groups/:id/icon`.
 *
 * `GET /api/invites/:code` e, nas palavras do proprio arquivo, "a unica rota
 * nao autenticada que devolve dado de grupo", e ela monta a resposta campo a
 * campo justamente para nao entregar o id interno a quem tem um codigo
 * vazado. Se o icone fosse `/api/groups/{id}/icon`, a previa de convite
 * desfaria essa defesa em silencio, num campo que ninguem olharia de novo.
 *
 * De quebra: o GET nao faz consulta nenhuma ao banco (a chave sai do proprio
 * caminho), e como a URL muda a cada troca ela pode ser servida como imutavel.
 *
 * ## Por que o GET nao pede sessao
 *
 * Este e um desvio consciente de `attachments.routes.ts`, que proxia todo byte
 * atras de `can()`. Vale registrar o raciocinio, porque quem ler os dois
 * arquivos vai estranhar:
 *
 * - um avatar nao e conteudo de canal e nao carrega informacao de
 *   pertencimento — saber que a imagem existe nao diz de que grupo ela e;
 * - exigir sessao quebraria a previa publica de convite, que precisa do icone;
 * - exigir pertencimento exigiria um calculo de audiencia NOVO, e audiencia so
 *   se calcula em `fanout.ts`. A regra vale mais do que a comodidade;
 * - o id tem 74 bits que ninguem adivinha.
 *
 * Um `requireAuth` bem-intencionado aqui quebraria a tela de convite. O teste
 * `GET /api/icons/:id` sem cookie devolve 200 existe para impedir isso.
 */
export function imagensRoutes(armazem: Armazem | null) {
  return async function registrar(app: FastifyInstance): Promise<void> {
    function exigirArmazem(): Armazem {
      if (armazem === null) throw new AppError('storage_unavailable')
      return armazem
    }

    /** Le o multipart e devolve os bytes ja conferidos. */
    async function receber(req: FastifyRequest): Promise<Buffer> {
      const arquivo = await req.file({ limits: { fileSize: LIMITE_DE_IMAGEM } })
      if (arquivo === undefined) throw new AppError('validation_failed')

      const dados = await arquivo.toBuffer()
      // `truncated` fica ligado quando o multipart cortou no limite. Sem isto
      // a imagem entraria pela metade e so falharia ao ser aberta.
      if (arquivo.file.truncated || dados.length > LIMITE_DE_IMAGEM) {
        throw new AppError('image_too_large')
      }
      if (dados.length === 0) throw new AppError('validation_failed')
      return dados
    }

    /**
     * Apaga o objeto que acabou de ser substituido.
     *
     * Best-effort de proposito: se a remocao falhar, o que sobra e um objeto
     * orfao ocupando quinze kilobytes. Propagar o erro desfaria uma troca de
     * foto que ja deu certo, o que e muito pior.
     */
    async function apagarAntigo(chave: string | null): Promise<void> {
      if (chave === null) return
      try {
        await exigirArmazem().remover([chave])
      } catch { /* orfao e barato; falhar a troca nao e */ }
    }

    async function servir(reply: FastifyReply, chave: string): Promise<FastifyReply> {
      let fluxo
      try {
        fluxo = await exigirArmazem().ler(chave)
      } catch {
        throw new AppError('not_found')
      }
      return reply
        .header('Content-Type', 'image/webp')
        .header('X-Content-Type-Options', 'nosniff')
        // `public`, ao contrario do anexo: ver o cabecalho deste arquivo. A URL
        // muda a cada upload, entao nenhuma versao antiga e servida por engano.
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(fluxo)
    }

    // ---------------------------------------------------------------- avatar

    app.post('/api/auth/me/avatar', { preHandler: requireAuth }, async (req, reply) => {
      const userId = req.user!.id
      exigirArmazem()

      const dados = await receber(req)
      const webp = await normalizarImagem(dados, LADO_DO_AVATAR)

      // A chave ANTIGA, lida antes de o update passar por cima: e ela que diz
      // qual objeto apagar, e depois do update ela nao existe mais em lugar
      // nenhum.
      const [u] = await db.select({ chave: users.avatarKey })
        .from(users).where(eq(users.id, userId)).limit(1)

      const mediaId = newId()
      const chave = chaveDoAvatar(mediaId)
      // Guardar ANTES de gravar a linha: um objeto orfao e disco desperdicado;
      // uma linha apontando para objeto inexistente e imagem quebrada na barra
      // lateral de todo mundo.
      await exigirArmazem().guardar(chave, webp, 'image/webp')

      const avatarUrl = `/api/avatars/${mediaId}`
      await db.update(users)
        .set({ avatarUrl, avatarKey: chave, updatedAt: new Date() })
        .where(eq(users.id, userId))
      await apagarAntigo(u?.chave ?? null)

      await emit.toPeersOf(userId, { t: 'user.updated', d: { userId, avatarUrl } })
      return reply.status(201).send({ avatarUrl })
    })

    app.delete('/api/auth/me/avatar', { preHandler: requireAuth }, async (req, reply) => {
      const userId = req.user!.id
      const [u] = await db.select({ chave: users.avatarKey })
        .from(users).where(eq(users.id, userId)).limit(1)

      await db.update(users)
        .set({ avatarUrl: null, avatarKey: null, updatedAt: new Date() })
        .where(eq(users.id, userId))
      await apagarAntigo(u?.chave ?? null)

      await emit.toPeersOf(userId, { t: 'user.updated', d: { userId, avatarUrl: null } })
      return reply.status(204).send()
    })

    app.get('/api/avatars/:id', async (req, reply) => {
      const id = uuidOu404((req.params as { id: string }).id)
      return servir(reply, chaveDoAvatar(id))
    })

    // ---------------------------------------------------------------- banner
    //
    // O topo do cartao de perfil. Mesmo desenho do avatar — UUID novo por
    // upload, GET sem sessao, objeto antigo apagado depois —, e pelos mesmos
    // motivos, escritos no cabecalho deste arquivo.

    app.post('/api/auth/me/banner', { preHandler: requireAuth }, async (req, reply) => {
      const userId = req.user!.id
      exigirArmazem()

      const dados = await receber(req)
      const webp = await normalizarImagem(dados, BANNER.largura, BANNER.altura)

      const [u] = await db.select({ chave: users.bannerKey })
        .from(users).where(eq(users.id, userId)).limit(1)

      const mediaId = newId()
      const chave = chaveDoBanner(mediaId)
      await exigirArmazem().guardar(chave, webp, 'image/webp')

      const bannerUrl = `/api/banners/${mediaId}`
      await db.update(users)
        .set({ bannerUrl, bannerKey: chave, updatedAt: new Date() })
        .where(eq(users.id, userId))
      await apagarAntigo(u?.chave ?? null)

      return reply.status(201).send({ bannerUrl })
    })

    app.delete('/api/auth/me/banner', { preHandler: requireAuth }, async (req, reply) => {
      const userId = req.user!.id
      const [u] = await db.select({ chave: users.bannerKey })
        .from(users).where(eq(users.id, userId)).limit(1)

      await db.update(users)
        .set({ bannerUrl: null, bannerKey: null, updatedAt: new Date() })
        .where(eq(users.id, userId))
      await apagarAntigo(u?.chave ?? null)

      return reply.status(204).send()
    })

    app.get('/api/banners/:id', async (req, reply) => {
      const id = uuidOu404((req.params as { id: string }).id)
      return servir(reply, chaveDoBanner(id))
    })

    // ----------------------------------------------------------------- icone

    app.post('/api/groups/:id/icon', { preHandler: requireAuth }, async (req, reply) => {
      const groupId = uuidOu404((req.params as { id: string }).id)
      exigirArmazem()

      const actor = await loadGroupActor(req.user!.id, groupId)
      assertCan(actor, 'group.update', { kind: 'group' })

      const dados = await receber(req)
      const webp = await normalizarImagem(dados, LADO_DO_ICONE)

      const [g] = await db.select({ chave: groups.iconKey })
        .from(groups).where(eq(groups.id, groupId)).limit(1)

      const mediaId = newId()
      const chave = chaveDoIcone(mediaId)
      await exigirArmazem().guardar(chave, webp, 'image/webp')

      const iconUrl = `/api/icons/${mediaId}`
      await db.update(groups).set({ iconUrl, iconKey: chave })
        .where(eq(groups.id, groupId))
      await apagarAntigo(g?.chave ?? null)

      // Sem isto o icone novo so apareceria para os outros ao recarregar.
      await emitirGrupoAtualizado(groupId, { iconUrl })
      return reply.status(201).send({ iconUrl })
    })

    app.delete('/api/groups/:id/icon', { preHandler: requireAuth }, async (req, reply) => {
      const groupId = uuidOu404((req.params as { id: string }).id)
      const actor = await loadGroupActor(req.user!.id, groupId)
      assertCan(actor, 'group.update', { kind: 'group' })

      const [g] = await db.select({ chave: groups.iconKey })
        .from(groups).where(eq(groups.id, groupId)).limit(1)

      await db.update(groups).set({ iconUrl: null, iconKey: null })
        .where(eq(groups.id, groupId))
      await apagarAntigo(g?.chave ?? null)

      await emitirGrupoAtualizado(groupId, { iconUrl: null })
      return reply.status(204).send()
    })

    app.get('/api/icons/:id', async (req, reply) => {
      const id = uuidOu404((req.params as { id: string }).id)
      return servir(reply, chaveDoIcone(id))
    })
  }
}
