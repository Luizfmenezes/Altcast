import { tocar } from '../../lib/sons.js'
import { useStore } from '../../lib/store.js'
import { useChamadaAtiva } from './chamadaAtiva.js'
import type { ServerEvent } from '../../lib/socket.js'

/**
 * A deixa sonora de quem CHEGA ou SAI da minha chamada.
 *
 * Mora no limite do socket, e nao dentro de `lib/store.ts`, por duas razoes
 * que se somam. A primeira e pratica: a store e um redutor puro que vinte
 * suites montam, e importar audio nela levaria `AudioContext` para todas elas.
 * A segunda e de significado: so aqui "veio do servidor" e um fato
 * estrutural — vista de dentro da store, a insercao otimista da propria
 * entrada e o evento de verdade sao indistinguiveis, e a pessoa ouviria a si
 * mesma chegando.
 */
export function cueDeEvento(evento: ServerEvent): void {
  /**
   * `track_published` fica de fora, e isso importa: ele dispara a cada vez que
   * QUALQUER pessoa liga ou desliga microfone, camera ou tela. Uma sala de
   * oito pessoas conversando viraria uma metralhadora.
   */
  if (evento.t !== 'voice.participant_joined' && evento.t !== 'voice.participant_left') {
    return
  }

  const d = evento.d as { channelId?: unknown; userId?: unknown }
  if (typeof d.channelId !== 'string' || typeof d.userId !== 'string') return

  // O servidor ecoa a minha propria entrada para mim — `emit.toChannel` nao
  // filtra o autor. Sem esta guarda, entrar numa chamada tocaria dois sons.
  if (d.userId === useStore.getState().user?.id) return

  const chamada = useChamadaAtiva.getState()

  // So a sala em que EU estou. O Discord nao apita por uma sala que voce
  // apenas esta olhando — e e isto, tambem, que torna um `ready` com cinco
  // pessoas estruturalmente mudo para todos os outros canais.
  if (d.channelId !== chamada.canal) return

  /**
   * Surdo cala o remoto, e nao o local.
   *
   * `definirSurdo` zera o volume das OUTRAS pessoas: e "calar a sala", nao
   * "calar o aplicativo". Quem aperta `D` e nao ouve confirmacao nenhuma fica
   * sem saber se funcionou — justamente no estado em que o retorno mais
   * importa. Entao a assimetria e deliberada: minhas acoes sempre soam,
   * chegada alheia nao.
   */
  if (chamada.chamada.surdo) return

  tocar(evento.t === 'voice.participant_joined' ? 'alguem-entrou' : 'alguem-saiu')
}
