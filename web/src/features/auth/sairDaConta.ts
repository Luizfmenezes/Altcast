import { SESSAO_EXPIROU, api } from '../../lib/api.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'
import { useRascunhos } from '../messages/rascunhos.js'

/**
 * Sair da conta.
 *
 * A API tinha `POST /api/auth/logout` desde o primeiro dia, e nenhuma tela o
 * chamava: a unica saida era esperar a sessao vencer em trinta dias ou apagar
 * os cookies na mao. Num computador compartilhado, isso e deixar a conta
 * aberta para o proximo.
 *
 * A ordem importa. A chamada cai PRIMEIRO, com a sessao ainda valida, para o
 * servidor ouvir o `voice.leave` e a sala nao guardar um fantasma. Depois a
 * sessao e revogada no servidor, e so entao a aba esquece tudo — rascunhos
 * incluidos, porque o proximo a sentar nesta aba nao pode ler o que a pessoa
 * anterior estava escrevendo.
 *
 * Falhar a revogacao nao prende ninguem dentro: o cookie e `httpOnly` e o
 * cliente nao consegue apaga-lo, mas a tela volta para o login do mesmo jeito
 * e a proxima requisicao dessa sessao morta ainda vale ate o servidor voltar.
 * Mostrar um erro e manter a pessoa "dentro" seria pior.
 */
export async function sairDaConta(): Promise<void> {
  await useChamadaAtiva.getState().sair().catch(() => undefined)
  await api.post('/auth/logout').catch(() => undefined)
  limparRascunhosDaAba()
  // O mesmo caminho da sessao expirada: `App` limpa a store, fecha o socket
  // e volta para a porta de entrada. Um segundo caminho de "sair" seria um
  // segundo lugar para esquecer de limpar alguma coisa.
  window.dispatchEvent(new Event(SESSAO_EXPIROU))
}

function limparRascunhosDaAba(): void {
  useRascunhos.setState({ rascunhos: {}, envios: [] })
  try {
    sessionStorage.removeItem('altcast:rascunhos')
  } catch {
    // Bloqueado: nada foi guardado ali, entao nao ha o que apagar.
  }
}
