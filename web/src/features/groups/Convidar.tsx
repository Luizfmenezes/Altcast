import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Link2, Trash2 } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { Separador } from '../../ui/Separador.js'

type Convite = {
  code: string
  expiresAt: string | null
  maxUses: number | null
  uses: number
}

const VALIDADES = [
  { rotulo: '30 minutos', horas: 0.5 },
  { rotulo: '1 dia', horas: 24 },
  { rotulo: '7 dias', horas: 168 },
  { rotulo: 'Nunca expira', horas: null },
] as const

const USOS = [
  { rotulo: 'Sem limite', quantos: null },
  { rotulo: '1 uso', quantos: 1 },
  { rotulo: '10 usos', quantos: 10 },
  { rotulo: '100 usos', quantos: 100 },
] as const

function linkDe(code: string): string {
  return `${window.location.origin}/convite/${code}`
}

/**
 * Convites do grupo.
 *
 * O codigo aparece em monoespacada porque e assim que ele circula de verdade:
 * ditado por telefone, lido em voz alta. A fonte que iguala a largura de cada
 * figura e o que impede confundir o que ja foi escolhido para nao se
 * confundir — o alfabeto do codigo nao tem I, L, O nem U.
 */
export function Convidar({ groupId }: { groupId: string }): ReactNode {
  const [convites, setConvites] = useState<Convite[]>([])
  const [validade, setValidade] = useState<number | null>(168)
  const [usos, setUsos] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    api.get<Convite[]>(`/groups/${groupId}/invites`)
      .then(lista => { if (vigente && Array.isArray(lista)) setConvites(lista) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [groupId])

  async function gerar(): Promise<void> {
    setErro(null)
    setGerando(true)
    try {
      const novo = await api.post<Convite>(`/groups/${groupId}/invites`, {
        ...(validade === null ? {} : { expiresInHours: validade }),
        ...(usos === null ? {} : { maxUses: usos }),
      })
      setConvites(atuais => [novo, ...atuais])
      await copiar(novo.code)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel gerar o convite.')
    } finally {
      setGerando(false)
    }
  }

  async function copiar(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(linkDe(code))
      setCopiado(code)
      window.setTimeout(() => setCopiado(null), 2000)
    } catch {
      // Area de transferencia negada pelo navegador. O link esta na tela e
      // pode ser selecionado a mao — nao vale um alerta.
    }
  }

  async function revogar(code: string): Promise<void> {
    setConvites(atuais => atuais.filter(c => c.code !== code))
    try {
      await api.delete(`/invites/${code}`)
    } catch {
      // Recarrega a lista para nao deixar na tela um estado que o servidor
      // nao confirmou.
      const lista = await api.get<Convite[]>(`/groups/${groupId}/invites`).catch(() => null)
      if (Array.isArray(lista)) setConvites(lista)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-fg">Convidar pessoas</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Quem abrir o link entra no grupo. Voce pode revogar a qualquer momento.
        </p>
      </div>

      {erro !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium text-fg">Validade</span>
          <select
            value={String(validade)}
            onChange={e => setValidade(e.target.value === 'null' ? null : Number(e.target.value))}
            className="h-9 rounded-md border border-border-subtle bg-bg px-2 text-fg"
          >
            {VALIDADES.map(v => (
              <option key={v.rotulo} value={String(v.horas)}>{v.rotulo}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium text-fg">Usos</span>
          <select
            value={String(usos)}
            onChange={e => setUsos(e.target.value === 'null' ? null : Number(e.target.value))}
            className="h-9 rounded-md border border-border-subtle bg-bg px-2 text-fg"
          >
            {USOS.map(u => (
              <option key={u.rotulo} value={String(u.quantos)}>{u.rotulo}</option>
            ))}
          </select>
        </label>

        <Botao onClick={() => { void gerar() }} disabled={gerando}>
          <Link2 aria-hidden="true" />
          {gerando ? 'Gerando...' : 'Gerar link'}
        </Botao>
      </div>

      {convites.length > 0 && (
        <>
          <Separador />
          <ul className="flex list-none flex-col gap-2">
            {convites.map(convite => (
              <li
                key={convite.code}
                className="flex flex-wrap items-center gap-2 rounded-md border
                           border-border-subtle bg-bg px-3 py-2"
              >
                <code className="font-mono text-[13px] tracking-wider text-fg">
                  {convite.code}
                </code>
                <span className="numerico text-[11px] text-fg-muted">
                  {convite.uses} de {convite.maxUses ?? 'sem limite'}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <Botao
                    variante="fantasma" tamanho="iconeSm"
                    onClick={() => { void copiar(convite.code) }}
                  >
                    {copiado === convite.code
                      ? <Check aria-hidden="true" className="text-presence-online" />
                      : <Copy aria-hidden="true" />}
                    <span className="sr-only">
                      {copiado === convite.code
                        ? `Link de ${convite.code} copiado`
                        : `Copiar link de ${convite.code}`}
                    </span>
                  </Botao>

                  {/* Revogar nao tem volta, e por isso pergunta antes. Um
                      clique sem confirmacao aqui apagaria, sem aviso, um link
                      que ja pode estar circulando com dezenas de pessoas. */}
                  <ConfirmarAcao
                    gatilho={
                      <Botao variante="fantasma" tamanho="iconeSm">
                        <Trash2 aria-hidden="true" />
                        <span className="sr-only">Revogar o convite {convite.code}</span>
                      </Botao>
                    }
                    titulo="Revogar este convite?"
                    descricao={
                      'Quem ja entrou continua no grupo. O codigo para de funcionar '
                      + 'para novas pessoas, e isso nao pode ser desfeito.'
                    }
                    confirmar="Revogar convite"
                    aoConfirmar={() => { void revogar(convite.code) }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
