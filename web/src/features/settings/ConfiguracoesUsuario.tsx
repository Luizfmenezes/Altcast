import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { TrocarSenha } from './TrocarSenha.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { useDensity, useTheme } from '../../ui/ThemeProvider.js'
import { descreverAparelho, haQuanto } from '../../lib/userAgent.js'

type SessaoAtiva = {
  handle: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

/**
 * Configuracoes da conta.
 *
 * A lista de sessoes usa o identificador publico devolvido pela API, nunca o
 * token da sessao: o que aparece na tela tambem aparece em captura de tela e em
 * log de suporte, e um token nesse caminho seria uma credencial vazada.
 */
export function ConfiguracoesUsuario(): ReactNode {
  const { theme, setTheme } = useTheme()
  const { density, setDensity } = useDensity()
  const [sessoes, setSessoes] = useState<SessaoAtiva[]>([])
  const [avisoDeSessoes, setAvisoDeSessoes] = useState<string | null>(null)

  useEffect(() => {
    void api.get<SessaoAtiva[]>('/auth/sessions')
      .then(lista => setSessoes(Array.isArray(lista) ? lista : []))
      .catch(() => undefined)
  }, [])

  async function encerrar(handle: string): Promise<void> {
    await api.delete(`/auth/sessions/${handle}`)
    setSessoes(atuais => atuais.filter(s => s.handle !== handle))
  }

  async function encerrarOutras(): Promise<void> {
    try {
      const { revoked } = await api.delete<{ revoked: number }>('/auth/sessions')
      setSessoes(atuais => atuais.filter(s => s.current))
      setAvisoDeSessoes(revoked === 1
        ? '1 sessão encerrada.'
        : `${String(revoked)} sessões encerradas.`)
    } catch {
      setAvisoDeSessoes('Não foi possível encerrar as outras sessões. Tente de novo.')
    }
  }

  const outras = sessoes.filter(s => !s.current).length

  return (
    // Sem cabecalho proprio nem botao de fechar: o dialogo que a contem ja tem
    // UM controle de fechar, e o segundo so criava duvida sobre qual deles
    // fecha o que.
    <section aria-label="Configurações da conta" className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Aparência
        </h2>
        <div className="flex flex-wrap gap-2">
          <Botao
            variante={theme === 'light' ? 'primario' : 'discreto'}
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            Tema claro
          </Botao>
          <Botao
            variante={theme === 'dark' ? 'primario' : 'discreto'}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            Tema escuro
          </Botao>
          {/*
            Densidade mexe so em espacamento: quem usa oito horas por dia quer
            mais linhas na tela, quem entra uma vez por semana quer respiro.
          */}
          <Botao
            variante={density === 'compact' ? 'primario' : 'discreto'}
            aria-pressed={density === 'compact'}
            onClick={() => setDensity('compact')}
          >
            Densidade compacta
          </Botao>
          <Botao
            variante={density === 'comfortable' ? 'primario' : 'discreto'}
            aria-pressed={density === 'comfortable'}
            onClick={() => setDensity('comfortable')}
          >
            Densidade confortável
          </Botao>
        </div>
      </div>

      <TrocarSenha />

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Sessões ativas
          </h2>
          {outras > 0 && (
            <ConfirmarAcao
              gatilho={<Botao variante="discreto" tamanho="sm">Encerrar todas as outras</Botao>}
              titulo="Encerrar todas as outras sessões?"
              descricao={
                `${outras === 1 ? 'O outro aparelho sai' : `Os outros ${String(outras)} aparelhos saem`} `
                + 'da conta imediatamente. Esta sessão continua aberta.'
              }
              confirmar="Encerrar as outras"
              aoConfirmar={() => void encerrarOutras()}
            />
          )}
        </div>
        {avisoDeSessoes !== null && (
          <p role="status" className="mb-2 text-sm text-fg-muted">{avisoDeSessoes}</p>
        )}
        <ul className="flex flex-col gap-1">
          {sessoes.map(sessao => {
            const aparelho = descreverAparelho(sessao.userAgent)
            return (
              <li
                key={sessao.handle}
                className="flex items-start justify-between gap-3 rounded border
                           border-border-subtle px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-fg">
                    {aparelho}
                    <span className="text-fg-muted"> · {haQuanto(sessao.lastSeenAt)}</span>
                  </span>
                  <span className="text-xs text-fg-muted">
                    {sessao.ip ?? 'Origem desconhecida'}
                  </span>
                  {/*
                    O user-agent inteiro, recolhido. Ninguem precisa dele para
                    reconhecer o proprio aparelho, e o suporte precisa dele
                    para diagnosticar — as duas necessidades cabem numa linha.
                  */}
                  {sessao.userAgent !== null && (
                    <details className="mt-1 text-xs text-fg-muted">
                      <summary className="cursor-pointer select-none">Detalhes técnicos</summary>
                      <p className="mt-1 break-all font-mono">{sessao.userAgent}</p>
                    </details>
                  )}
                </div>

                {sessao.current ? (
                  // Marcar a sessao atual evita que alguem se desconecte sem
                  // querer e depois nao entenda por que caiu.
                  <span className="shrink-0 text-xs font-medium text-fg-muted">Esta sessão</span>
                ) : (
                  <ConfirmarAcao
                    gatilho={
                      <Botao variante="discreto" tamanho="sm" aria-label={`Encerrar ${aparelho}`}>
                        Encerrar
                      </Botao>
                    }
                    titulo="Encerrar esta sessão?"
                    descricao={
                      `O acesso em ${aparelho} termina imediatamente e será preciso `
                      + 'entrar de novo naquele aparelho.'
                    }
                    confirmar="Encerrar sessão"
                    aoConfirmar={() => void encerrar(sessao.handle)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
