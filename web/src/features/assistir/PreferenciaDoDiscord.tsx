import type { ReactNode } from 'react'
import { Botao } from '../../ui/Botao.js'
import {
  definirPreferenciaDoDiscord, temDiscord, usarPreferenciaDoDiscord,
} from './atividadeNoDiscord.js'

/**
 * Liga e desliga o cartao do Discord.
 *
 * So existe no app de desktop: no navegador nao ha cartao nenhum para
 * desligar, e um controle sem efeito seria uma promessa falsa.
 */
export function PreferenciaDoDiscord(): ReactNode {
  const ligado = usarPreferenciaDoDiscord()
  if (!temDiscord()) return null

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Discord
      </h2>
      <p className="mb-3 text-[13px] text-fg-muted">
        Mostra no seu perfil do Discord quando você está em chamada ou transmitindo, com o
        nome do grupo. Ao transmitir, seus amigos veem o botão “Assistir no Altcast” e
        podem pedir para entrar; você decide.
      </p>
      <div className="flex flex-wrap gap-2">
        <Botao
          variante={ligado ? 'primario' : 'discreto'}
          aria-pressed={ligado}
          onClick={() => { definirPreferenciaDoDiscord(true) }}
        >
          Mostrar no Discord
        </Botao>
        <Botao
          variante={ligado ? 'discreto' : 'primario'}
          aria-pressed={!ligado}
          onClick={() => { definirPreferenciaDoDiscord(false) }}
        >
          Não mostrar
        </Botao>
      </div>
    </div>
  )
}
