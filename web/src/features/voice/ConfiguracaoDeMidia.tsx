import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { listarDispositivos, lerPreferencias } from '../../lib/midia.js'
import type { Dispositivo, TipoDeDispositivo } from '../../lib/midia.js'

const ROTULOS: Record<TipoDeDispositivo, string> = {
  audioinput: 'Microfone',
  videoinput: 'Camera',
  audiooutput: 'Saida de som',
}

const TIPOS: TipoDeDispositivo[] = ['audioinput', 'videoinput', 'audiooutput']

function Escolha({ tipo, valor, aoEscolher, dispositivos }: {
  tipo: TipoDeDispositivo
  valor: string
  aoEscolher: (deviceId: string) => void
  dispositivos: Dispositivo[]
}): ReactNode {
  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1">
      <span className="text-[13px] font-medium text-fg">{ROTULOS[tipo]}</span>
      <select
        value={valor}
        onChange={e => aoEscolher(e.target.value)}
        disabled={dispositivos.length === 0}
        className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg
                   disabled:cursor-not-allowed disabled:opacity-60"
      >
        {dispositivos.length === 0 && <option value="">Nenhum disponivel</option>}
        {dispositivos.map(d => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </label>
  )
}

/**
 * Medidor do que o microfone esta captando.
 *
 * A barra existe porque "o microfone esta ligado" e "estao me ouvindo" sao
 * duas coisas diferentes: o botao responde a primeira, e so o nivel responde a
 * segunda. Sem ela, descobrir que o microfone escolhido era o errado depende
 * de alguem do outro lado avisar.
 */
function Medidor({ nivel, ativo }: { nivel: number; ativo: boolean }): ReactNode {
  const porcento = Math.round(Math.min(1, Math.max(0, nivel)) * 100)

  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1">
      <span className="text-[13px] font-medium text-fg">
        {ativo ? 'O que estao ouvindo' : 'Microfone desligado'}
      </span>
      <div
        role="meter"
        aria-label="Nivel do microfone"
        aria-valuenow={porcento}
        aria-valuemin={0}
        aria-valuemax={100}
        // O texto acompanha o valor porque uma barra que so cresce em pixels
        // nao existe para quem usa leitor de tela.
        aria-valuetext={ativo ? `${String(porcento)} por cento` : 'Microfone desligado'}
        className="h-9 overflow-hidden rounded border border-border bg-bg-raised"
      >
        <div
          className={`h-full transition-[width] duration-75 ${
            ativo ? 'bg-accent' : 'bg-transparent'}`}
          style={{ width: `${String(porcento)}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Escolher microfone, camera e saida de som.
 *
 * A lista so traz os NOMES depois que o navegador concede a permissao — antes
 * disso ele devolve rotulos vazios de proposito, para que um site nao consiga
 * identificar a maquina sem pedir. Por isso a lista e relida quando o microfone
 * liga: e nesse instante que os nomes de verdade aparecem.
 */
export function ConfiguracaoDeMidia({ nivel, microfoneLigado, aoTrocar }: {
  nivel: number
  microfoneLigado: boolean
  aoTrocar: (tipo: TipoDeDispositivo, deviceId: string) => void
}): ReactNode {
  const [dispositivos, setDispositivos] = useState<Record<TipoDeDispositivo, Dispositivo[]>>({
    audioinput: [], videoinput: [], audiooutput: [],
  })
  const [escolhido, setEscolhido] = useState<Partial<Record<TipoDeDispositivo, string>>>(
    () => lerPreferencias(),
  )

  useEffect(() => {
    let vigente = true

    void Promise.all(TIPOS.map(listarDispositivos)).then(([entrada, video, saida]) => {
      if (!vigente) return
      setDispositivos({
        audioinput: entrada ?? [], videoinput: video ?? [], audiooutput: saida ?? [],
      })
    })

    return () => { vigente = false }
    // Reler quando o microfone liga: e o momento em que a permissao sai e os
    // nomes de verdade substituem os rotulos vazios.
  }, [microfoneLigado])

  function escolher(tipo: TipoDeDispositivo, deviceId: string): void {
    setEscolhido(atual => ({ ...atual, [tipo]: deviceId }))
    aoTrocar(tipo, deviceId)
  }

  /** O primeiro da lista e o que o navegador ja usa quando nada foi escolhido. */
  const valorDe = (tipo: TipoDeDispositivo): string =>
    escolhido[tipo] ?? dispositivos[tipo][0]?.deviceId ?? ''

  return (
    <details className="rounded border border-border-subtle">
      <summary className="cursor-pointer px-3 py-2 text-sm text-fg">
        Configurar dispositivos
      </summary>

      <div className="flex flex-wrap items-end gap-3 border-t border-border-subtle p-3">
        {TIPOS.map(tipo => (
          <Escolha
            key={tipo}
            tipo={tipo}
            valor={valorDe(tipo)}
            aoEscolher={id => escolher(tipo, id)}
            dispositivos={dispositivos[tipo]}
          />
        ))}

        <Medidor nivel={nivel} ativo={microfoneLigado} />
      </div>

      {dispositivos.audioinput.length === 0 && (
        <p className="px-3 pb-3 text-xs text-fg-muted">
          O navegador ainda nao liberou os dispositivos. Ligue o microfone uma vez
          para conceder a permissao e ver os nomes.
        </p>
      )}
    </details>
  )
}
