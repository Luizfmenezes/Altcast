/**
 * Quem esta em qual chamada, agora.
 *
 * Mesma natureza da presenca: memoria, nunca banco. Uma chamada nao e um fato
 * historico que alguem va consultar amanha — e um fato sobre sockets abertos
 * neste instante. Reiniciar a API esvazia as salas, e os clientes as
 * reconstroem ao reconectar, o que e correto e nao um defeito.
 *
 * O LiveKit tambem sabe quem esta na sala, e de proposito nao perguntamos a
 * ele: a fonte da audiencia continua sendo `fanout.ts`, e uma segunda fonte de
 * verdade sobre quem esta onde seria uma segunda chance de vazar canal privado.
 */
export type EstadoDeMidia = { microfone: boolean; camera: boolean; tela: boolean }

export type Participante = EstadoDeMidia & { userId: string }

const MUDO: EstadoDeMidia = { microfone: false, camera: false, tela: false }

const porCanal = new Map<string, Map<string, EstadoDeMidia>>()

function salaDe(channelId: string): Map<string, EstadoDeMidia> {
  const atual = porCanal.get(channelId)
  if (atual) return atual
  const nova = new Map<string, EstadoDeMidia>()
  porCanal.set(channelId, nova)
  return nova
}

export const calls = {
  /**
   * true apenas quando a pessoa ACABOU de entrar. Uma segunda aba que repete o
   * `voice.join` nao gera um segundo anuncio — a identidade no LiveKit e o
   * proprio userId, entao duas abas sao a mesma pessoa na sala.
   */
  join(channelId: string, userId: string): boolean {
    const sala = salaDe(channelId)
    if (sala.has(userId)) return false
    sala.set(userId, { ...MUDO })
    return true
  },

  /** true apenas quando a pessoa de fato estava na sala. */
  leave(channelId: string, userId: string): boolean {
    const sala = porCanal.get(channelId)
    if (!sala?.delete(userId)) return false
    // Sala vazia nao fica no mapa: sem isto, cada canal ja usado uma vez
    // ocuparia memoria para sempre guardando um Map vazio.
    if (sala.size === 0) porCanal.delete(channelId)
    return true
  },

  /** Atualiza o que a pessoa esta transmitindo. `null` se ela nao esta na sala. */
  atualizar(channelId: string, userId: string, parcial: Partial<EstadoDeMidia>): Participante | null {
    const atual = porCanal.get(channelId)?.get(userId)
    if (!atual) return null
    const novo = { ...atual, ...parcial }
    porCanal.get(channelId)!.set(userId, novo)
    return { userId, ...novo }
  },

  participantes(channelId: string): Participante[] {
    return [...(porCanal.get(channelId) ?? new Map())]
      .map(([userId, estado]) => ({ userId, ...estado }))
  },

  /** Em quais canais esta pessoa esta em chamada — o que a queda do socket precisa saber. */
  canaisDe(userId: string): string[] {
    return [...porCanal].filter(([, sala]) => sala.has(userId)).map(([canal]) => canal)
  },

  clear(): void {
    porCanal.clear()
  },
}
