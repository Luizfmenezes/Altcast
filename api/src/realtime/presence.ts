/**
 * Presenca por transicao, mantida em memoria.
 *
 * Nao persiste porque nao e dado: e um fato sobre conexoes que existem agora.
 * Reiniciar a API zera a presenca, que se reconstroi em segundos conforme os
 * clientes reconectam — isso e correto, nao um defeito.
 *
 * O contador — e nao um booleano — e o que faz cinco abas do mesmo usuario
 * produzirem exatamente um evento `online` e um `offline`, em vez de dez.
 */
const conexoesPorUsuario = new Map<string, number>()

export const presence = {
  /** true apenas quando o usuario ACABOU de ficar online. */
  connect(userId: string): boolean {
    const anterior = conexoesPorUsuario.get(userId) ?? 0
    conexoesPorUsuario.set(userId, anterior + 1)
    return anterior === 0
  },

  /** true apenas quando a ultima conexao do usuario caiu. */
  disconnect(userId: string): boolean {
    const anterior = conexoesPorUsuario.get(userId) ?? 0
    if (anterior <= 1) {
      conexoesPorUsuario.delete(userId)
      return anterior === 1
    }
    conexoesPorUsuario.set(userId, anterior - 1)
    return false
  },

  isOnline(userId: string): boolean {
    return (conexoesPorUsuario.get(userId) ?? 0) > 0
  },

  clear(): void {
    conexoesPorUsuario.clear()
  },
}
