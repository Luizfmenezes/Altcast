import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { GestaoDeCanais } from './GestaoDeCanais.js'

type Convite = {
  code: string
  uses: number
  maxUses: number | null
  expiresAt: string | null
}

const QUANDO = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Configuracoes do grupo.
 *
 * Aqui vive a unica excecao a regra de invisibilidade: quem administra ve os
 * NOMES dos canais privados, porque precisa poder apagar um canal orfao. A tela
 * diz isso em voz alta, com um rotulo em cada linha inacessivel - sem o rotulo,
 * a lista sugeriria um acesso que nao existe, e o primeiro clique frustrado
 * ensinaria a regra da pior maneira.
 */
export function ConfiguracoesGrupo({ groupId, aoFechar }: {
  groupId: string
  aoFechar: () => void
}): ReactNode {
  const [convites, setConvites] = useState<Convite[]>([])
  const [novoConvite, setNovoConvite] = useState<Convite | null>(null)

  const carregarConvites = useCallback(async () => {
    const lista = await api.get<Convite[]>(`/groups/${groupId}/invites`)
    setConvites(Array.isArray(lista) ? lista : [])
  }, [groupId])

  useEffect(() => {
    void carregarConvites().catch(() => undefined)
  }, [carregarConvites])

  async function gerarConvite(): Promise<void> {
    const criado = await api.post<Convite>(`/groups/${groupId}/invites`, {})
    setNovoConvite(criado)
    await carregarConvites().catch(() => undefined)
  }

  async function revogar(code: string): Promise<void> {
    await api.delete(`/invites/${code}`)
    setConvites(atuais => atuais.filter(c => c.code !== code))
  }

  return (
    <section aria-label="Configuracoes do grupo" className="flex flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-fg">Configuracoes do grupo</h1>
        <Botao variante="discreto" onClick={aoFechar}>Fechar</Botao>
      </header>

      <GestaoDeCanais groupId={groupId} />

      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Convites
        </h2>

        <Botao onClick={() => void gerarConvite()}>Gerar convite</Botao>

        {novoConvite && (
          <p className="mt-3 text-sm text-fg">
            Codigo gerado:{' '}
            {/* Monoespacada: este codigo vai ser ditado por telefone. */}
            <code className="font-mono tracking-widest text-accent">{novoConvite.code}</code>
          </p>
        )}

        <ul className="mt-3 flex flex-col gap-1">
          {convites.map(convite => (
            <li
              key={convite.code}
              className="flex items-center justify-between gap-3 rounded border
                         border-border-subtle px-3 py-2"
            >
              <span className="flex items-baseline gap-3">
                <code className="font-mono text-sm tracking-widest text-fg">
                  {convite.code}
                </code>
                <span className="text-[11px] text-fg-muted">
                  {convite.uses} uso(s)
                  {convite.expiresAt !== null
                    && ` - expira em ${QUANDO.format(new Date(convite.expiresAt))}`}
                </span>
              </span>

              <ConfirmarAcao
                gatilho={
                  <Botao variante="discreto" aria-label={`Revogar ${convite.code}`}>
                    Revogar
                  </Botao>
                }
                titulo="Revogar este convite?"
                descricao={
                  'Quem ja entrou continua no grupo. O codigo para de funcionar '
                  + 'para novas pessoas, e isso nao pode ser desfeito.'
                }
                confirmar="Revogar convite"
                aoConfirmar={() => void revogar(convite.code)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
