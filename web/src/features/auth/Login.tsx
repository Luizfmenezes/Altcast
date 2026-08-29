import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api, rearmarAvisoDeSessao } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'

export type Usuario = { id: string; email: string; displayName: string; avatarUrl: string | null }

export function Login({ aoEntrar }: { aoEntrar: (u: Usuario) => void }): ReactNode {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const campoEmail = useRef<HTMLInputElement>(null)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const { user } = await api.post<{ user: Usuario }>('/auth/login', { email, password: senha })
      rearmarAvisoDeSessao()
      aoEntrar(user)
    } catch (e) {
      // A mensagem vem do servidor e e deliberadamente uniforme: dizer qual dos
      // dois campos errou entregaria a lista de quem tem conta.
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel entrar. Tente novamente.')
      // Devolver o foco ao primeiro campo evita que quem navega por teclado
      // precise reencontrar o formulario depois do erro (SC 3.3.3).
      campoEmail.current?.focus()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <h1 className="text-lg font-semibold text-fg">Entrar no Altcast</h1>

      {erro && (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <Campo
        rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
        autoComplete="email" referencia={campoEmail} obrigatorio
      />
      <Campo
        rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha}
        autoComplete="current-password" obrigatorio
      />

      <Botao type="submit" disabled={enviando}>{enviando ? 'Entrando...' : 'Entrar'}</Botao>
    </form>
  )
}
