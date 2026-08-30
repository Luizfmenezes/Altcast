import { useState } from 'react'
import type { ReactNode } from 'react'
import { MailWarning, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'

/**
 * Aviso de e-mail nao confirmado.
 *
 * Dispensavel, e nao bloqueante: quem acabou de criar a conta pode ler e
 * escrever normalmente, e so criar grupo e emitir convite dependem da
 * confirmacao. Uma barra que nao se pudesse fechar cobraria por algo que ainda
 * nao esta no caminho da pessoa.
 *
 * Fechar vale para a aba, e nao para sempre: o aviso volta na proxima visita,
 * porque o motivo dele continua de pe.
 */
export function FaixaDeVerificacao(): ReactNode {
  const user = useStore(e => e.user)
  const [fechada, setFechada] = useState(false)
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'enviado' | 'falhou'>('ocioso')

  // `undefined` e servidor antigo, que nao sabe do assunto; `null` e conta que
  // de fato nao confirmou. Sao casos diferentes, e so o segundo vira aviso.
  if (fechada || user?.emailVerifiedAt !== null) return null

  async function reenviar(): Promise<void> {
    setEstado('enviando')
    try {
      await api.post('/auth/resend-verification', {})
      setEstado('enviado')
    } catch {
      setEstado('falhou')
    }
  }

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b
                 border-border-subtle bg-bg-raised px-3 py-2 text-[13px]"
    >
      <MailWarning aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-fg-muted" />

      <p className="min-w-0 flex-1 text-fg-muted">
        {estado === 'enviado'
          ? <>Link novo enviado para <strong className="text-fg">{user.email}</strong>.</>
          : estado === 'falhou'
            ? 'Nao foi possivel reenviar agora. Tente daqui a pouco.'
            : <>Confirme seu e-mail para criar grupos e convidar pessoas.</>}
      </p>

      {estado !== 'enviado' && (
        <Botao
          variante="vinculo" tamanho="sm"
          onClick={() => { void reenviar() }}
          disabled={estado === 'enviando'}
        >
          {estado === 'enviando' ? 'Enviando...' : 'Reenviar link'}
        </Botao>
      )}

      <Botao variante="fantasma" tamanho="iconeSm" onClick={() => setFechada(true)}>
        <X aria-hidden="true" />
        <span className="sr-only">Fechar aviso</span>
      </Botao>
    </div>
  )
}
