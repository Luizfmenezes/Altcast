import { useState } from 'react'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'

export type EstadoDoReenvio = 'ocioso' | 'enviando' | 'enviado' | 'falhou'

/**
 * Reenviar o e-mail de confirmacao.
 *
 * Extraido porque agora existem DOIS lugares que precisam disso — a faixa do
 * topo e a tela de boas-vindas de quem nao tem grupo nenhum — e a segunda e
 * justamente onde a trava aparece. Duas copias da mesma chamada seriam duas
 * chances de uma delas parar de tratar o erro.
 *
 * O servidor limita a tres por hora por conta. Falhar aqui nao e excepcional:
 * e a resposta esperada para quem clicou quatro vezes.
 */
export function useReenviarVerificacao(): {
  estado: EstadoDoReenvio
  reenviar: () => Promise<void>
  /** Nulo quando a conta ja confirmou, ou quando o servidor nao fala disso. */
  endereco: string | null
  precisaConfirmar: boolean
} {
  const user = useStore(e => e.user)
  const [estado, setEstado] = useState<EstadoDoReenvio>('ocioso')

  // `undefined` e servidor antigo, que nao sabe do assunto; `null` e conta que
  // de fato nao confirmou. Sao casos diferentes, e so o segundo trava alguem.
  const precisaConfirmar = user?.emailVerifiedAt === null

  async function reenviar(): Promise<void> {
    setEstado('enviando')
    try {
      await api.post('/auth/resend-verification', {})
      setEstado('enviado')
    } catch {
      setEstado('falhou')
    }
  }

  return {
    estado,
    reenviar,
    endereco: precisaConfirmar ? (user?.email ?? null) : null,
    precisaConfirmar,
  }
}
