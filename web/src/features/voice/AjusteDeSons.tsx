import { useState } from 'react'
import type { ReactNode } from 'react'
import { Volume2 } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import {
  destravarSons, guardarPreferenciaDeSons, lerPreferenciaDeSons, tocar,
} from '../../lib/sons.js'
import type { PreferenciaDeSons } from '../../lib/sons.js'

/**
 * As deixas sonoras da chamada: ligar, desligar e o volume.
 *
 * Controle EXPLICITO, e nao derivado de `prefers-reduced-motion`. Quem pediu
 * menos animacao nao disse nada sobre som, e tratar as duas coisas como uma so
 * desligaria audio para quem nunca pediu isso.
 *
 * O botao de testar nao e cortesia: um controle de volume que a pessoa nao
 * consegue ouvir enquanto mexe e um controle ajustado no chute. Ele tambem e o
 * gesto que destrava o audio no navegador, o que faz a primeira deixa de
 * verdade sair sem atraso.
 */
export function AjusteDeSons(): ReactNode {
  const [preferencia, setPreferencia] = useState<PreferenciaDeSons>(lerPreferenciaDeSons)

  function aplicar(mudanca: Partial<PreferenciaDeSons>): PreferenciaDeSons {
    const novo = { ...preferencia, ...mudanca }
    setPreferencia(novo)
    guardarPreferenciaDeSons(novo)
    return novo
  }

  return (
    <fieldset className="flex flex-col gap-3 border-t border-border-subtle px-3 py-3">
      <legend className="sr-only">Sons da chamada</legend>

      <label className="flex items-center gap-2 text-[13px] text-fg">
        <input
          type="checkbox"
          checked={preferencia.ligado}
          onChange={e => { aplicar({ ligado: e.currentTarget.checked }) }}
          className="size-4 accent-accent"
        />
        Sons da chamada
      </label>
      <p className="text-xs text-fg-muted">
        Avisos curtos ao entrar, sair, mutar e transmitir a tela.
      </p>

      <div className="flex items-center gap-3">
        <label
          htmlFor="volume-dos-sons"
          className="flex items-center gap-1.5 text-xs text-fg-muted"
        >
          <Volume2 aria-hidden="true" className="size-4" />
          Volume
        </label>
        <input
          id="volume-dos-sons"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(preferencia.volume * 100)}
          disabled={!preferencia.ligado}
          onChange={e => { aplicar({ volume: Number(e.currentTarget.value) / 100 }) }}
          className="min-w-0 flex-1 accent-accent disabled:opacity-40"
        />
        <Botao
          type="button"
          variante="discreto"
          tamanho="sm"
          disabled={!preferencia.ligado}
          onClick={() => {
            // Destravar antes: sem um gesto o navegador recusa o som, e o
            // botao de testar pareceria quebrado justamente na primeira vez.
            destravarSons()
            tocar('entrei')
          }}
        >
          Testar
        </Botao>
      </div>
    </fieldset>
  )
}
