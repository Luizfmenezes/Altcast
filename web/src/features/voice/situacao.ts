import type { EstadoDaChamada } from '../../lib/midia.js'

/**
 * Em que pe esta a chamada, numa palavra so.
 *
 * A barra do rodape e o painel de voz respondiam essa pergunta cada um do seu
 * jeito, e discordavam: a barra olhava "existe um canal de chamada?" e dizia
 * "Na chamada"; o painel olhava `fase` e dizia "Fora da chamada". As duas ao
 * mesmo tempo, na mesma tela, sempre que a entrada falhava. Agora as duas
 * leem ESTA funcao, sobre o MESMO estado de `chamadaAtiva`.
 *
 *   ocioso -> conectando -> conectado <-> reconectando
 *                 \              \
 *                  +-> falhou <---+
 */
export type Situacao = 'ocioso' | 'conectando' | 'conectado' | 'reconectando' | 'falhou'

export function situacaoDaChamada(canal: string | null, chamada: EstadoDaChamada): Situacao {
  if (canal === null) return 'ocioso'
  switch (chamada.fase) {
    case 'erro': return 'falhou'
    case 'dentro': return chamada.reconectando ? 'reconectando' : 'conectado'
    // `fora` com canal escolhido e o instante entre o clique e o inicio da
    // conexao: para quem clicou, isso ja e "conectando".
    case 'fora':
    case 'entrando':
      return 'conectando'
  }
}

/** O rotulo curto de cada situacao, o mesmo na barra e no painel. */
export function rotuloDaSituacao(situacao: Situacao, canal: string | null): string {
  const onde = canal === null ? '' : ` — ${canal}`
  switch (situacao) {
    case 'ocioso': return 'Fora da chamada'
    case 'conectando': return `Conectando${onde}`
    case 'conectado': return `No ar${onde}`
    case 'reconectando': return `Reconectando${onde}`
    case 'falhou': return `Falha na chamada${onde}`
  }
}
