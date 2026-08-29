import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'

export type CanalDeGestao = {
  id: string
  name: string
  type: 'text' | 'voice'
  visibility: 'public' | 'private'
  position: number
  contentAccessible: boolean
}

type Rascunho = { name: string; topic: string; visibility: 'public' | 'private' }

/** Select nativo com rotulo de verdade — mesma razao do Campo: rotulo nao some. */
function Selecao({ rotulo, valor, aoMudar, opcoes }: {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  opcoes: { valor: string; texto: string }[]
}): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-fg">{rotulo}</span>
      <select
        value={valor}
        onChange={e => aoMudar(e.target.value)}
        className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg"
      >
        {opcoes.map(o => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  )
}

/**
 * Criar, renomear e apagar canais — de texto e de voz.
 *
 * O tipo aparece na criacao e NUNCA na edicao, porque o servidor tambem nao
 * aceita troca-lo: um canal de texto tem historico e um canal de voz nao, e
 * converter um no outro decidiria sozinho o que fazer com as mensagens. Quem
 * precisa do outro tipo cria outro canal, que e a operacao honesta.
 *
 * A copia local da lista existe porque esta tela ve NOMES de canais privados
 * que a barra lateral, de proposito, nunca recebe. O `channel.created` do
 * WebSocket cuida da barra lateral sozinho.
 */
export function GestaoDeCanais({ groupId }: { groupId: string }): ReactNode {
  const [canais, setCanais] = useState<CanalDeGestao[]>([])
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'text' | 'voice'>('text')
  const [visibilidade, setVisibilidade] = useState<'public' | 'private'>('public')
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho>({
    name: '', topic: '', visibility: 'public',
  })

  const carregar = useCallback(async () => {
    const lista = await api.get<CanalDeGestao[]>(`/groups/${groupId}/channels/manage`)
    setCanais(Array.isArray(lista) ? lista : [])
  }, [groupId])

  useEffect(() => {
    void carregar().catch(() => undefined)
  }, [carregar])

  /** O texto do erro vem do servidor: ele e quem conhece a regra do nome. */
  function relatar(e: unknown): void {
    if (!(e instanceof ApiError)) return setErro('Algo deu errado. Tente novamente.')
    const primeiro = Object.values(e.camposInvalidos)[0]?.[0]
    setErro(primeiro ?? e.message)
  }

  async function criar(): Promise<void> {
    setErro(null)
    try {
      await api.post(`/groups/${groupId}/channels`, {
        name: nome, type: tipo, visibility: visibilidade,
      })
      // Recarregar em vez de acrescentar o que o POST devolveu: o servidor
      // normaliza o nome (minusculas, hifens) e decide a posicao, e montar a
      // linha a partir de um palpite mostraria um canal diferente do que passou
      // a existir.
      await carregar()
      setNome('')
    } catch (e) {
      relatar(e)
    }
  }

  function abrirEdicao(canal: CanalDeGestao): void {
    setErro(null)
    setEditando(canal.id)
    setRascunho({ name: canal.name, topic: '', visibility: canal.visibility })
  }

  async function salvar(id: string): Promise<void> {
    setErro(null)
    try {
      await api.patch(`/channels/${id}`, {
        name: rascunho.name,
        topic: rascunho.topic.trim() === '' ? null : rascunho.topic,
        visibility: rascunho.visibility,
      })
      // Mesma razao da criacao: o nome que vale e o que o servidor gravou.
      await carregar()
      setEditando(null)
    } catch (e) {
      relatar(e)
    }
  }

  async function apagar(id: string): Promise<void> {
    setErro(null)
    try {
      await api.delete(`/channels/${id}`)
      setCanais(atuais => atuais.filter(c => c.id !== id))
    } catch (e) {
      relatar(e)
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Canais
      </h2>

      {erro !== null && (
        <p
          role="alert"
          className="mb-3 rounded border border-danger px-3 py-2 text-sm text-danger"
        >
          {erro}
        </p>
      )}

      <form
        aria-label="Novo canal"
        className="mb-4 flex flex-wrap items-end gap-3 rounded border border-border-subtle p-3"
        onSubmit={e => {
          e.preventDefault()
          void criar()
        }}
      >
        <div className="min-w-[180px] flex-1">
          <Campo rotulo="Nome do canal" valor={nome} aoMudar={setNome} obrigatorio />
        </div>
        <Selecao
          rotulo="Tipo"
          valor={tipo}
          aoMudar={v => setTipo(v as 'text' | 'voice')}
          opcoes={[
            { valor: 'text', texto: 'Texto' },
            { valor: 'voice', texto: 'Voz' },
          ]}
        />
        <Selecao
          rotulo="Visibilidade"
          valor={visibilidade}
          aoMudar={v => setVisibilidade(v as 'public' | 'private')}
          opcoes={[
            { valor: 'public', texto: 'Publico' },
            { valor: 'private', texto: 'Privado' },
          ]}
        />
        <Botao type="submit" disabled={nome.trim() === ''}>Criar canal</Botao>
      </form>

      <ul className="flex flex-col gap-1">
        {canais.map(canal => (
          <li key={canal.id} className="rounded border border-border-subtle px-3 py-2">
            {editando === canal.id ? (
              <form
                aria-label={`Editar ${canal.name}`}
                className="flex flex-wrap items-end gap-3"
                onSubmit={e => {
                  e.preventDefault()
                  void salvar(canal.id)
                }}
              >
                <div className="min-w-[160px] flex-1">
                  <Campo
                    rotulo="Nome"
                    valor={rascunho.name}
                    aoMudar={v => setRascunho(r => ({ ...r, name: v }))}
                  />
                </div>
                <div className="min-w-[160px] flex-1">
                  <Campo
                    rotulo="Assunto"
                    valor={rascunho.topic}
                    aoMudar={v => setRascunho(r => ({ ...r, topic: v }))}
                    dica="Deixe vazio para remover"
                  />
                </div>
                <Selecao
                  rotulo="Visibilidade"
                  valor={rascunho.visibility}
                  aoMudar={v => setRascunho(r => ({
                    ...r, visibility: v as 'public' | 'private',
                  }))}
                  opcoes={[
                    { valor: 'public', texto: 'Publico' },
                    { valor: 'private', texto: 'Privado' },
                  ]}
                />
                <Botao type="submit">Salvar</Botao>
                <Botao variante="discreto" type="button" onClick={() => setEditando(null)}>
                  Cancelar
                </Botao>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-fg">
                  <span aria-hidden="true" className="text-fg-muted">
                    {canal.type === 'voice' ? 'voz' : '#'}
                  </span>
                  <span>{canal.name}</span>
                  <span className="text-[11px] text-fg-muted">
                    {canal.visibility === 'private' ? 'privado' : 'publico'}
                  </span>
                </span>

                <span className="flex items-center gap-2">
                  {!canal.contentAccessible && (
                    <span
                      className="rounded border border-border-subtle px-2 py-0.5 text-[11px]
                                 text-fg-muted"
                    >
                      Conteudo inacessivel
                    </span>
                  )}

                  <Botao
                    variante="discreto"
                    aria-label={`Editar ${canal.name}`}
                    onClick={() => abrirEdicao(canal)}
                  >
                    Editar
                  </Botao>

                  <ConfirmarAcao
                    gatilho={
                      <Botao variante="perigo" aria-label={`Apagar ${canal.name}`}>
                        Apagar
                      </Botao>
                    }
                    titulo={`Apagar o canal ${canal.name}?`}
                    descricao="As mensagens do canal vao junto, e isso nao pode ser desfeito."
                    confirmar="Apagar canal"
                    aoConfirmar={() => void apagar(canal.id)}
                  />
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
