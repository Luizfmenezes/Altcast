import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'

/**
 * Troca de senha de quem ja esta dentro.
 *
 * Exige a senha atual mesmo havendo sessao valida: um aparelho deixado
 * desbloqueado nao deve bastar para trocar a credencial e expulsar a pessoa da
 * propria conta.
 *
 * O servidor derruba as OUTRAS sessoes e emite um cookie novo para esta aba.
 * Dizer isso na tela importa — sem o aviso, descobrir que o celular foi
 * desconectado parece defeito em vez de protecao.
 */
export function TrocarSenha(): ReactNode {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string[]>>({})
  const [pronto, setPronto] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setCampos({})
    setPronto(false)
    setEnviando(true)
    try {
      await api.patch('/auth/password', { currentPassword: atual, newPassword: nova })
      setAtual('')
      setNova('')
      setPronto(true)
    } catch (e) {
      const apiErro = e instanceof ApiError ? e : null
      setErro(apiErro?.message ?? 'Nao foi possivel trocar a senha.')
      setCampos(apiErro?.camposInvalidos ?? {})
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Senha
      </h2>

      {erro !== null && (
        <p role="alert" className="mb-3 rounded-md border border-danger px-3 py-2
                                   text-sm text-danger">
          {erro}
        </p>
      )}
      {pronto && (
        <p role="status" className="mb-3 rounded-md border border-border-subtle px-3 py-2
                                    text-sm text-fg-muted">
          Senha trocada. As outras sessoes foram encerradas; esta continua valendo.
        </p>
      )}

      <form onSubmit={enviar} className="flex max-w-sm flex-col gap-3" noValidate>
        <Campo
          rotulo="Senha atual" tipo="password" valor={atual} aoMudar={setAtual}
          autoComplete="current-password" obrigatorio
          erro={campos['currentPassword']?.[0]}
        />
        <Campo
          rotulo="Nova senha" tipo="password" valor={nova} aoMudar={setNova}
          autoComplete="new-password" obrigatorio
          dica="Ao menos 12 caracteres."
          erro={campos['newPassword']?.[0] ?? campos['password']?.[0]}
        />
        <div>
          <Botao type="submit" disabled={enviando || atual === '' || nova === ''}>
            {enviando ? 'Trocando...' : 'Trocar senha'}
          </Botao>
        </div>
      </form>
    </div>
  )
}
