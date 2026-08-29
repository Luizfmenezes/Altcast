import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { useDensity, useTheme } from '../../ui/ThemeProvider.js'

type SessaoAtiva = {
  handle: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

const QUANDO = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Configuracoes da conta.
 *
 * A lista de sessoes usa o identificador publico devolvido pela API, nunca o
 * token da sessao: o que aparece na tela tambem aparece em captura de tela e em
 * log de suporte, e um token nesse caminho seria uma credencial vazada.
 */
export function ConfiguracoesUsuario({ aoFechar }: { aoFechar: () => void }): ReactNode {
  const { theme, setTheme } = useTheme()
  const { density, setDensity } = useDensity()
  const [sessoes, setSessoes] = useState<SessaoAtiva[]>([])

  useEffect(() => {
    void api.get<SessaoAtiva[]>('/auth/sessions')
      .then(lista => setSessoes(Array.isArray(lista) ? lista : []))
      .catch(() => undefined)
  }, [])

  async function encerrar(handle: string): Promise<void> {
    await api.delete(`/auth/sessions/${handle}`)
    setSessoes(atuais => atuais.filter(s => s.handle !== handle))
  }

  return (
    <section aria-label="Configuracoes da conta" className="flex flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-fg">Sua conta</h1>
        <Botao variante="discreto" onClick={aoFechar}>Fechar</Botao>
      </header>

      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Aparencia
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
            Densidade confortavel
          </Botao>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Sessoes ativas
        </h2>
        <ul className="flex flex-col gap-1">
          {sessoes.map(sessao => {
            const aparelho = sessao.userAgent ?? 'Aparelho desconhecido'
            return (
              <li
                key={sessao.handle}
                className="flex items-center justify-between gap-3 rounded border
                           border-border-subtle px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="text-sm text-fg">{aparelho}</span>
                  <span className="text-[11px] text-fg-muted">
                    {sessao.ip ?? 'origem desconhecida'} - visto em{' '}
                    {QUANDO.format(new Date(sessao.lastSeenAt))}
                  </span>
                </span>

                {sessao.current ? (
                  // Marcar a sessao atual evita que alguem se desconecte sem
                  // querer e depois nao entenda por que caiu.
                  <span className="text-[11px] text-fg-muted">Esta sessao</span>
                ) : (
                  <ConfirmarAcao
                    gatilho={
                      <Botao variante="discreto" aria-label={`Encerrar ${aparelho}`}>
                        Encerrar
                      </Botao>
                    }
                    titulo="Encerrar esta sessao?"
                    descricao={
                      `O acesso em ${aparelho} termina imediatamente e sera preciso `
                      + 'entrar de novo naquele aparelho.'
                    }
                    confirmar="Encerrar sessao"
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
