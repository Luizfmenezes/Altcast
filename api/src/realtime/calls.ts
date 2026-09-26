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

/**
 * A saida adiada de quem perdeu o socket, por usuario.
 *
 * Existe porque a queda do WebSocket e a queda da chamada sao coisas
 * diferentes: a sala do SFU sobrevive a uma piscada de rede, e expulsar
 * alguem do mapa no instante em que o socket cai deixava a pessoa audivel
 * para os outros e invisivel na lista — sem recuperacao possivel, porque nada
 * a recolocava la.
 */
const saidasAdiadas = new Map<string, NodeJS.Timeout>()

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

  /**
   * Agenda a saida desta pessoa de TODAS as salas dela.
   *
   * Nao emite nada: quem conhece `emit` e o gateway, e manter esta separacao e
   * o que impede um segundo lugar no sistema a decidir audiencia. O `aoExpirar`
   * devolve o controle para la.
   *
   * Reconexao dentro da janela cancela tudo e NAO produz evento nenhum — nem
   * `left`, nem `joined`. Para quem esta olhando a lista, nada aconteceu, que
   * e exatamente o que deve parecer quando nada aconteceu.
   */
  agendarSaida(userId: string, ms: number, aoExpirar: (channelId: string) => void): void {
    this.cancelarSaida(userId)
    const canais = this.canaisDe(userId)
    if (canais.length === 0) return
    const timer = setTimeout(() => {
      saidasAdiadas.delete(userId)
      for (const channelId of canais) aoExpirar(channelId)
    }, ms)
    // unref pelo mesmo motivo do heartbeat: um timer pendurado impediria o
    // processo de encerrar sozinho.
    timer.unref()
    saidasAdiadas.set(userId, timer)
  },

  /** Cancela a saida agendada. true se havia uma. */
  cancelarSaida(userId: string): boolean {
    const timer = saidasAdiadas.get(userId)
    if (timer === undefined) return false
    clearTimeout(timer)
    saidasAdiadas.delete(userId)
    return true
  },

  clear(): void {
    porCanal.clear()
    // Os timers TAMBEM, e nao so as salas: um timer sobrevivente de um teste
    // dispararia no meio do proximo, tirando da chamada alguem que acabou de
    // entrar. O mesmo vale em producao para qualquer reinicio a quente.
    for (const timer of saidasAdiadas.values()) clearTimeout(timer)
    saidasAdiadas.clear()
  },
}
