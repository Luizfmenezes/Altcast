import { describe, it, expect } from 'vitest'
import { withTestDb } from './helpers/db.js'
import { cenarioComAdmin, loginComo } from './helpers/fixtures.js'
import { comServidor, conectado, espere, esperarFrame } from './helpers/ws.js'

/**
 * Os eventos que os grupos nao tinham.
 *
 * Os canais sempre emitiram `channel.created`, `channel.updated` e
 * `channel.deleted`; os grupos nao emitiam nada. Nao eram tres bugs — era um
 * so, com tres sintomas: criar um grupo, aceitar um convite e trocar o nome ou
 * a imagem so apareciam depois de recarregar a pagina, porque nada no sistema
 * sabia contar a um cliente que a lista de grupos DELE tinha mudado.
 *
 * Cada caso aqui falha contra o codigo anterior a esta fatia.
 */
describe('eventos de grupo', () => {
  it('criar um grupo entrega group.created com os canais junto', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const eu = await loginComo(app, db, 'eu@x.com')
        const { ws, frames } = await conectado(url, eu.cookie)

        const criado = await app.inject({
          method: 'POST', url: '/api/groups',
          headers: { cookie: eu.cookie }, payload: { name: 'Time novo' },
        })
        expect(criado.statusCode).toBe(201)

        const frame = await esperarFrame(frames, 'group.created')
        const d = frame.d as {
          group: { id: string; name: string; role: string }
          channels: { name: string }[]
        }
        expect(d.group.id).toBe(criado.json().id)
        expect(d.group.role).toBe('owner')
        // Os canais vao junto: sem eles o cliente ganharia um grupo sem nada
        // para abrir, e a tela ficaria vazia do mesmo jeito.
        expect(d.channels.map(c => c.name)).toEqual(['geral'])

        ws.close()
      })
    })
  })

  it('aceitar um convite por codigo entrega group.joined a quem aceitou', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const convite = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/invites`,
          headers: { cookie: base.cookieDono }, payload: {},
        })
        const codigo = convite.json().code as string

        const ze = await loginComo(app, db, 'ze@x.com')
        const { ws, frames } = await conectado(url, ze.cookie)

        const aceite = await app.inject({
          method: 'POST', url: `/api/invites/${codigo}/accept`,
          headers: { cookie: ze.cookie },
        })
        expect(aceite.statusCode).toBe(200)

        // `member.joined` conta ao GRUPO que chegou gente; nao conta a quem
        // chegou que ele ganhou um grupo. Era esse o buraco.
        const frame = await esperarFrame(frames, 'group.joined')
        const d = frame.d as { group: { id: string }; channels: unknown[] }
        expect(d.group.id).toBe(base.groupId)
        expect(d.channels.length).toBeGreaterThan(0)

        ws.close()
      })
    })
  })

  it('aceitar um convite dirigido entrega group.joined com o papel do convite', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const ze = await loginComo(app, db, 'ze@x.com')
        // Precisa dividir um grupo para aparecer no seletor; o e-mail resolve
        // para a conta existente do mesmo jeito.
        const convite = await app.inject({
          method: 'POST', url: `/api/groups/${base.groupId}/invitations`,
          headers: { cookie: base.cookieDono },
          payload: { email: 'ze@x.com', role: 'admin' },
        })
        expect(convite.statusCode).toBe(201)

        const { ws, frames } = await conectado(url, ze.cookie)
        await app.inject({
          method: 'POST', url: `/api/invitations/${convite.json().id}/accept`,
          headers: { cookie: ze.cookie },
        })

        const frame = await esperarFrame(frames, 'group.joined')
        expect((frame.d as { group: { role: string } }).group.role).toBe('admin')

        ws.close()
      })
    })
  })

  it('renomear o grupo entrega group.updated a todos', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const dono = await conectado(url, base.cookieDono)
        const admin = await conectado(url, base.cookieAdmin)

        const res = await app.inject({
          method: 'PATCH', url: `/api/groups/${base.groupId}`,
          headers: { cookie: base.cookieDono }, payload: { name: 'Outro nome' },
        })
        expect(res.statusCode).toBe(200)

        // O icone ja emitia desde sempre; o NOME nunca emitiu — por isso
        // renomear um grupo nao mudava nada na tela de ninguem, nem na de
        // quem renomeou.
        for (const lado of [dono, admin]) {
          const frame = await esperarFrame(lado.frames, 'group.updated')
          expect(frame.d).toMatchObject({ id: base.groupId, name: 'Outro nome' })
        }

        dono.ws.close(); admin.ws.close()
      })
    })
  })

  it('apagar o grupo avisa quem estava dentro, e nao so quem apagou', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const base = await cenarioComAdmin(app, db)
        const admin = await conectado(url, base.cookieAdmin)

        await app.inject({
          method: 'DELETE', url: `/api/groups/${base.groupId}`,
          headers: { cookie: base.cookieDono },
        })

        // A audiencia e capturada ANTES do DELETE: perguntar depois devolveria
        // lista vazia, e ninguem receberia o aviso — todos ficariam com um
        // grupo fantasma na barra ate recarregar.
        const frame = await esperarFrame(admin.frames, 'group.deleted')
        expect(frame.d).toMatchObject({ id: base.groupId })

        admin.ws.close()
      })
    })
  })

  it('group.created nao vaza para quem nao esta no grupo', async () => {
    await withTestDb(async db => {
      await comServidor(async (app, url) => {
        const estranho = await loginComo(app, db, 'estranho@x.com')
        const { ws, frames } = await conectado(url, estranho.cookie)

        const eu = await loginComo(app, db, 'eu@x.com')
        await app.inject({
          method: 'POST', url: '/api/groups',
          headers: { cookie: eu.cookie }, payload: { name: 'Nao e seu' },
        })

        await espere(300)
        expect(frames.filter(f => f.t.startsWith('group.'))).toEqual([])

        ws.close()
      })
    })
  })
})
