import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { gravarTesteDeMicrofone, testeDisponivel } from '../../lib/testeDeMicrofone.js'
import type { Gravacao } from '../../lib/testeDeMicrofone.js'

const SEGUNDOS = 5

type Fase =
  | { tipo: 'parado' }
  | { tipo: 'gravando'; fracao: number }
  | { tipo: 'pronto'; gravacao: Gravacao }
  | { tipo: 'erro'; mensagem: string }

/**
 * Gravar cinco segundos e ouvir o antes e o depois.
 *
 * Responde a pergunta que nenhum interruptor responde: "o que estao ouvindo
 * de mim?". Sem ela, ajustar a supressao e um chute, e a confirmacao depende
 * de alguem do outro lado da chamada.
 */
export function TesteDeMicrofone(): ReactNode {
  const [fase, setFase] = useState<Fase>({ tipo: 'parado' })
  const ultima = useRef<Gravacao | null>(null)

  // As URLs `blob:` seguram os audios na memoria ate serem soltas.
  useEffect(() => () => { ultima.current?.liberar() }, [])

  if (!testeDisponivel()) {
    return (
      <p className="border-t border-border-subtle p-3 text-xs text-fg-muted">
        Este navegador não consegue gravar o teste de microfone.
      </p>
    )
  }

  async function testar(): Promise<void> {
    ultima.current?.liberar()
    ultima.current = null
    setFase({ tipo: 'gravando', fracao: 0 })
    try {
      const gravacao = await gravarTesteDeMicrofone(SEGUNDOS, fracao => {
        setFase({ tipo: 'gravando', fracao })
      })
      ultima.current = gravacao
      setFase({ tipo: 'pronto', gravacao })
    } catch {
      setFase({
        tipo: 'erro',
        mensagem: 'Não foi possível gravar. Confira se o navegador liberou o microfone.',
      })
    }
  }

  const gravando = fase.tipo === 'gravando'

  return (
    <section aria-labelledby="teste-de-microfone" className="flex flex-col gap-2 border-t border-border-subtle p-3">
      <h3 id="teste-de-microfone" className="text-[13px] font-medium text-fg">Teste de microfone</h3>
      <p className="text-xs text-fg-muted">
        Grava {SEGUNDOS} segundos e toca duas versões: o microfone cru e o que a sala
        ouve com o tratamento escolhido acima. Fale normalmente, com o barulho de sempre.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void testar() }}
          disabled={gravando}
          className="rounded border border-border px-3 text-sm text-fg hover:bg-bg-hover
                     focus-visible:bg-bg-hover disabled:opacity-60"
          style={{ minHeight: 'var(--height-row)' }}
        >
          {gravando ? 'Gravando…' : fase.tipo === 'pronto' ? 'Gravar de novo' : `Gravar ${String(SEGUNDOS)} segundos`}
        </button>
        {gravando && (
          <div
            role="progressbar"
            aria-label="Gravando o teste"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fase.fracao * 100)}
            className="h-2 min-w-[160px] flex-1 overflow-hidden rounded bg-bg-raised"
          >
            <div className="h-full bg-accent" style={{ width: `${String(Math.round(fase.fracao * 100))}%` }} />
          </div>
        )}
      </div>
      {fase.tipo === 'erro' && <p role="alert" className="text-xs text-danger">{fase.mensagem}</p>}
      {fase.tipo === 'pronto' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="flex flex-col gap-1">
            <figcaption className="text-xs font-medium text-fg">Antes: o microfone cru</figcaption>
            <audio src={fase.gravacao.original} controls preload="auto" className="w-full" />
          </figure>
          <figure className="flex flex-col gap-1">
            <figcaption className="text-xs font-medium text-fg">Depois: o que a sala ouve</figcaption>
            <audio src={fase.gravacao.tratado} controls preload="auto" className="w-full" />
          </figure>
        </div>
      )}
    </section>
  )
}
