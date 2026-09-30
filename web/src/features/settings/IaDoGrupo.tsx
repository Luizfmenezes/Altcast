import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Interruptor } from '../../ui/Interruptor.js'

type Recurso = { recurso: string; ativo: boolean; incluiPrivados: boolean }
type EstadoDaIa = { disponivel: boolean; foraDoAr: boolean; recursos: Recurso[] }

/**
 * Os recursos de IA que ja existem, com o que cada um manda para fora.
 *
 * A explicacao e a primeira coisa da tela, antes do interruptor: ligar um
 * recurso e decidir que textos do grupo passam por um servico externo, e essa
 * decisao so e informada se a pessoa souber exatamente quais.
 */
const DESCRICOES: Record<string, { nome: string; faz: string; envia: string }> = {
  triagem: {
    nome: 'Triagem de notificações',
    faz: 'Para quem escolher o nível "Inteligente", avisa também das mensagens que parecem pedir atenção — perguntas ao grupo, decisões, prazos —, mesmo sem menção.',
    envia: 'O texto da mensagem, as cinco anteriores do canal com os autores trocados por apelidos ("autor", "pessoa_1"), e o nome e o assunto do canal. Nunca e-mails, nomes de pessoas ou identificadores.',
  },
}

export function IaDoGrupo({ groupId }: { groupId: string }): ReactNode {
  const [estado, setEstado] = useState<EstadoDaIa | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    api.get<EstadoDaIa>(`/groups/${groupId}/ai`)
      .then(e => { if (vigente) setEstado(e) })
      .catch(() => { if (vigente) setErro('Não foi possível carregar as configurações de IA.') })
    return () => { vigente = false }
  }, [groupId])

  async function alterar(recurso: string, mudanca: Partial<Pick<Recurso, 'ativo' | 'incluiPrivados'>>): Promise<void> {
    if (estado === null) return
    const atual = estado.recursos.find(r => r.recurso === recurso)
    if (atual === undefined) return
    setErro(null)
    try {
      const r = await api.put<Recurso>(`/groups/${groupId}/ai/${recurso}`, {
        ativo: mudanca.ativo ?? atual.ativo,
        incluiPrivados: mudanca.incluiPrivados ?? atual.incluiPrivados,
      })
      setEstado({ ...estado, recursos: estado.recursos.map(x => x.recurso === recurso ? r : x) })
    } catch {
      setErro('Não foi possível salvar. Tente de novo.')
    }
  }

  if (estado === null) {
    return erro === null
      ? <p role="status" className="text-sm text-fg-muted">Carregando…</p>
      : <p role="alert" className="text-sm text-danger">{erro}</p>
  }

  return (
    <section aria-label="Inteligência artificial" className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm leading-relaxed text-fg-muted">
        Recursos que usam um modelo de julgamento (TypeSafe · Jev) para decisões rápidas. Todos
        começam desligados, só valem para este grupo, e têm sempre um caminho sem IA: se o serviço
        cair, o Altcast continua funcionando como antes. A IA nunca apaga, bane ou expulsa ninguém.
      </p>

      {!estado.disponivel && (
        <p role="status" className="rounded-md border border-border-subtle bg-bg-sunken px-3 py-2 text-sm text-fg-muted">
          Indisponível neste servidor: o operador não configurou a chave do serviço. O que for
          escolhido aqui fica guardado para quando houver.
        </p>
      )}
      {estado.disponivel && estado.foraDoAr && (
        <p role="status" className="text-sm text-warning">
          O serviço está fora do ar agora. Os recursos voltam sozinhos em alguns minutos.
        </p>
      )}
      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

      {estado.recursos.filter(r => DESCRICOES[r.recurso] !== undefined).map(r => {
        const d = DESCRICOES[r.recurso]!
        const id = `ia-${r.recurso}`
        return (
          <div key={r.recurso} className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <label htmlFor={id} className="text-sm font-semibold text-fg">{d.nome}</label>
                <p className="mt-1 text-sm text-fg-muted">{d.faz}</p>
              </div>
              <Interruptor
                id={id}
                ligado={r.ativo}
                aoMudar={ativo => { void alterar(r.recurso, { ativo }) }}
              />
            </div>
            <p className="text-xs text-fg-muted">
              <span className="font-medium text-fg">O que é enviado: </span>{d.envia}
            </p>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={r.incluiPrivados}
                disabled={!r.ativo}
                onChange={e => { void alterar(r.recurso, { incluiPrivados: e.target.checked }) }}
                className="size-4 accent-[var(--color-accent)]"
              />
              Incluir canais privados
            </label>
          </div>
        )
      })}
    </section>
  )
}
