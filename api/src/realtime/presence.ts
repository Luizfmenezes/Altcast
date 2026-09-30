/**
 * Presenca por transicao, mantida em memoria.
 *
 * Nao persiste porque nao e dado: e um fato sobre conexoes que existem agora.
 * Reiniciar a API zera a presenca, que se reconstroi em segundos conforme os
 * clientes reconectam — isso e correto, nao um defeito.
 *
 * O contador — e nao um booleano — e o que faz cinco abas do mesmo usuario
 * produzirem exatamente um evento `online` e um `offline`, em vez de dez.
 *
 * ## Status (Etapa 2 do super plano)
 *
 * O que os OUTROS veem combina tres fatos:
 *
 * - ha conexao? Sem nenhuma, `offline`;
 * - o que a pessoa ESCOLHEU (`users.status`, no banco): `invisible` aparece
 *   `offline` para todo mundo, `dnd` e `idle` aparecem como tais;
 * - o ausente AUTOMATICO: o cliente avisa quando ficou dez minutos sem uso. Ele
 *   mora aqui, e nao no banco, pelo mesmo motivo da presenca — e um fato sobre
 *   a conexao de agora, que nao sobrevive a ela.
 */
export type StatusEscolhido = 'online' | 'idle' | 'dnd' | 'invisible'
export type StatusVisivel = 'online' | 'idle' | 'dnd' | 'offline'

const conexoesPorUsuario = new Map<string, number>()
/** O status escolhido de quem esta conectado, carregado na conexao. */
const escolhidos = new Map<string, StatusEscolhido>()
/** Quem o cliente disse estar sem uso ha dez minutos. */
const ociosos = new Set<string>()

export const presence = {
  /** true apenas quando o usuario ACABOU de ficar online. */
  connect(userId: string, escolhido: StatusEscolhido = 'online'): boolean {
    const anterior = conexoesPorUsuario.get(userId) ?? 0
    conexoesPorUsuario.set(userId, anterior + 1)
    escolhidos.set(userId, escolhido)
    return anterior === 0
  },

  /** true apenas quando a ultima conexao do usuario caiu. */
  disconnect(userId: string): boolean {
    const anterior = conexoesPorUsuario.get(userId) ?? 0
    if (anterior <= 1) {
      conexoesPorUsuario.delete(userId)
      escolhidos.delete(userId)
      ociosos.delete(userId)
      return anterior === 1
    }
    conexoesPorUsuario.set(userId, anterior - 1)
    return false
  },

  isOnline(userId: string): boolean {
    return (conexoesPorUsuario.get(userId) ?? 0) > 0
  },

  /**
   * O status que os outros veem. `offline` tambem para o invisivel: aparecer
   * "invisivel" para os outros entregaria exatamente o que a pessoa quis
   * esconder.
   */
  visivel(userId: string): StatusVisivel {
    if (!this.isOnline(userId)) return 'offline'
    const escolhido = escolhidos.get(userId) ?? 'online'
    if (escolhido === 'invisible') return 'offline'
    if (escolhido === 'dnd') return 'dnd'
    if (escolhido === 'idle' || ociosos.has(userId)) return 'idle'
    return 'online'
  },

  /** Troca o escolhido de quem esta conectado. Devolve o visivel de antes. */
  escolher(userId: string, escolhido: StatusEscolhido): StatusVisivel {
    const antes = this.visivel(userId)
    if (this.isOnline(userId)) escolhidos.set(userId, escolhido)
    return antes
  },

  /** O cliente avisou que ficou (ou deixou de ficar) sem uso. Devolve o visivel de antes. */
  ocioso(userId: string, ocioso: boolean): StatusVisivel {
    const antes = this.visivel(userId)
    if (ocioso) ociosos.add(userId)
    else ociosos.delete(userId)
    return antes
  },

  clear(): void {
    conexoesPorUsuario.clear()
    escolhidos.clear()
    ociosos.clear()
  },
}
