import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore, possoNoGrupo } from '../../lib/store.js'
import { recortarQuadrado } from '../../lib/avatar.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { Separador } from '../../ui/Separador.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'

/**
 * Nome e imagem do grupo.
 *
 * A API para isto existia inteira — `PATCH /groups/:id`, `POST /groups/:id/icon`
 * e `DELETE /groups/:id/icon`, com normalizacao para WebP, limpeza do objeto
 * antigo e evento de tempo real —, e nenhuma tela a chamava. Na pratica isso
 * significava que nenhum grupo tinha foto e nenhum nome podia ser corrigido
 * depois de criado: a funcionalidade estava pronta e era inalcancavel.
 *
 * O formulario de nome e a foto sao dois caminhos separados de proposito. A
 * foto sobe no instante em que e escolhida — e o que as pessoas esperam de um
 * seletor de imagem, e um botao "salvar" ali so adiaria o unico feedback que
 * importa, que e ver a imagem trocada.
 */

const ACEITOS = 'image/png,image/jpeg,image/gif,image/webp'
const LIMITE_BYTES = 8 * 1024 * 1024

export function IdentidadeDoGrupo({ groupId }: { groupId: string }): ReactNode {
  const grupo = useStore(e => e.groups.find(g => g.id === groupId))
  const posso = useStore(e => possoNoGrupo(e, groupId, 'group.update'))
  const podeApagar = useStore(e => possoNoGrupo(e, groupId, 'group.delete'))

  const [nome, setNome] = useState(grupo?.name ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [erroFoto, setErroFoto] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'nome' | 'foto' | 'apagar' | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  // O nome pode mudar por baixo — outra aba, outra pessoa administrando — e o
  // `group.updated` atualiza a store. Sincronizar o campo com ela evita a tela
  // mostrar um nome antigo num input que ninguem tocou. Enquanto ha edicao em
  // andamento o campo manda, senao a digitacao seria sobrescrita no meio.
  const editando = useRef(false)
  useEffect(() => {
    if (!editando.current) setNome(grupo?.name ?? '')
  }, [grupo?.name])

  if (grupo === undefined) return null

  async function salvarNome(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null); setRecado(null); setOcupado('nome')
    try {
      await api.patch(`/groups/${groupId}`, { name: nome.trim() })
      // Nada de mexer na store: o `group.updated` do socket chega com o nome
      // novo e atualiza a barra lateral, o cabecalho e a lista de todo mundo.
      editando.current = false
      setRecado('Nome atualizado.')
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel salvar o nome.')
    } finally {
      setOcupado(null)
    }
  }

  async function enviarFoto(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    // Zerado antes de qualquer `await`: sem isto, escolher o MESMO arquivo de
    // novo depois de um erro nao dispara `change`, e o botao parece morto.
    evento.target.value = ''
    if (arquivo === undefined) return

    setErroFoto(null)
    if (arquivo.size > LIMITE_BYTES) {
      setErroFoto('A imagem passa do limite de 8 MB.')
      return
    }

    setOcupado('foto')
    try {
      // Mesmo recorte do avatar de pessoa: a subida vira dezenas de KB em vez
      // de varios megabytes. Sem canvas no navegador, sobe o original e o
      // servidor normaliza.
      const recortado = await recortarQuadrado(arquivo)
      const corpo = new FormData()
      corpo.append('file', recortado ?? arquivo, 'icone.webp')

      const resposta = await fetch(`/api/groups/${groupId}/icon`, {
        method: 'POST', body: corpo, credentials: 'include',
      })
      if (!resposta.ok) {
        const envelope = await resposta.json().catch(() => null) as
          { error?: { message?: string } } | null
        throw new Error(envelope?.error?.message ?? 'Nao foi possivel enviar a imagem.')
      }
      setRecado('Imagem atualizada.')
    } catch (e) {
      setErroFoto(e instanceof Error ? e.message : 'Nao foi possivel enviar a imagem.')
    } finally {
      setOcupado(null)
    }
  }

  async function removerFoto(): Promise<void> {
    setErroFoto(null); setOcupado('foto')
    try {
      await api.delete(`/groups/${groupId}/icon`)
      setRecado('Imagem removida.')
    } catch (e) {
      setErroFoto(e instanceof ApiError ? e.message : 'Nao foi possivel remover a imagem.')
    } finally {
      setOcupado(null)
    }
  }

  async function apagarGrupo(): Promise<void> {
    setErro(null); setOcupado('apagar')
    try {
      // O `group.deleted` tira o grupo da barra e aponta a tela para outro.
      await api.delete(`/groups/${groupId}`)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel apagar o grupo.')
      setOcupado(null)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">Imagem do grupo</h3>
          <p className="mt-1 text-[13px] text-fg-muted">
            Ela aparece na barra lateral, na previa do convite e no topo da lista de canais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Avatar nome={grupo.name} url={grupo.iconUrl} className="size-16 text-lg" />
          <div className="flex flex-col gap-2">
            <input
              ref={entrada}
              type="file"
              accept={ACEITOS}
              onChange={evento => { void enviarFoto(evento) }}
              className="sr-only"
              // Fora da vista e sem `<label>` visivel: quem chega por leitor de
              // tela precisa ouvir o que o campo e. `tabIndex={-1}` porque o
              // botao ao lado ja e o caminho de teclado, e duas paradas para a
              // mesma acao so confundem.
              aria-label="Escolher imagem do grupo"
              tabIndex={-1}
              disabled={!posso}
            />
            <div className="flex flex-wrap gap-2">
              <Botao
                type="button" variante="discreto"
                disabled={!posso || ocupado === 'foto'}
                onClick={() => entrada.current?.click()}
              >
                <Upload aria-hidden="true" className="size-4" />
                {ocupado === 'foto' ? 'Enviando...' : 'Escolher imagem'}
              </Botao>
              {grupo.iconUrl !== null && (
                <Botao
                  type="button" variante="fantasma"
                  disabled={!posso || ocupado === 'foto'}
                  onClick={() => { void removerFoto() }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remover
                </Botao>
              )}
            </div>
            <p className="text-xs text-fg-muted">PNG, JPEG, GIF ou WebP, ate 8 MB.</p>
          </div>
        </div>

        {erroFoto !== null && (
          <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
            {erroFoto}
          </p>
        )}
      </section>

      <Separador />

      <form onSubmit={evento => { void salvarNome(evento) }} className="flex flex-col gap-4" noValidate>
        <div>
          <h3 className="text-[15px] font-semibold text-fg">Nome</h3>
          <p className="mt-1 text-[13px] text-fg-muted">
            De 2 a 64 caracteres. Todo mundo do grupo ve a mudanca na hora.
          </p>
        </div>

        <div className="max-w-sm">
          <Campo
            rotulo="Nome do grupo"
            valor={nome}
            aoMudar={v => { editando.current = true; setNome(v) }}
            obrigatorio
          />
        </div>

        {erro !== null && (
          <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
            {erro}
          </p>
        )}
        {recado !== null && (
          <p role="status" className="text-[13px] text-fg-muted">{recado}</p>
        )}

        <div>
          <Botao
            type="submit"
            disabled={!posso || ocupado === 'nome' || nome.trim() === '' || nome.trim() === grupo.name}
          >
            {ocupado === 'nome' ? 'Salvando...' : 'Salvar nome'}
          </Botao>
        </div>
      </form>

      {podeApagar && (
        <>
          <Separador />
          {/*
            A zona de perigo fica no fim da PRIMEIRA secao, e nao numa aba
            propria escondida: quem procura "como apago este grupo" procura nas
            configuracoes gerais dele. Esconder a acao destrutiva nao protege
            ninguem — a confirmacao protege.
          */}
          <section className="flex flex-col gap-3 rounded-lg border border-danger/40 p-4">
            <div>
              <h3 className="text-[15px] font-semibold text-danger">Apagar o grupo</h3>
              <p className="mt-1 text-[13px] text-fg-muted">
                Apaga os canais, as conversas, os anexos e os cargos. Nao tem volta.
              </p>
            </div>
            <div>
              <ConfirmarAcao
                titulo={`Apagar ${grupo.name}?`}
                descricao={
                  'Os canais, as conversas e os arquivos deste grupo somem para todo mundo. '
                  + 'Nao existe desfazer.'
                }
                confirmar="Apagar para sempre"
                aoConfirmar={() => { void apagarGrupo() }}
                gatilho={
                  <Botao variante="perigo" disabled={ocupado === 'apagar'}>
                    <Trash2 aria-hidden="true" className="size-4" />
                    Apagar grupo
                  </Botao>
                }
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
