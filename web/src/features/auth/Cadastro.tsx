import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api, rearmarAvisoDeSessao } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import type { Usuario } from './Login.js'

/**
 * Cadastro so existe com codigo de convite no contexto. A tela nem e alcancavel
 * sem ele: oferecer o formulario e recusar no envio seria prometer o que o
 * servidor nao entrega.
 */
export function Cadastro({ codigo, aoEntrar }: {
  codigo: string
  aoEntrar: (u: Usuario) => void
}): ReactNode {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string[]>>({})
  const [enviando, setEnviando] = useState(false)
  const campoNome = useRef<HTMLInputElement>(null)
  const campoEmail = useRef<HTMLInputElement>(null)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setCampos({})
    setEnviando(true)
    try {
      const { user } = await api.post<{ user: Usuario }>('/auth/register', {
        email, password: senha, displayName: nome, inviteCode: codigo,
      })
      rearmarAvisoDeSessao()
      aoEntrar(user)
    } catch (e) {
      const apiErro = e instanceof ApiError ? e : null
      setErro(apiErro?.message ?? 'Nao foi possivel criar a conta. Tente novamente.')
      const invalidos = apiErro?.camposInvalidos ?? {}
      setCampos(invalidos)
      // Foco no primeiro campo invalido, na ordem em que aparecem na tela.
      const alvo = invalidos['displayName'] ? campoNome : campoEmail
      alvo.current?.focus()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <h1 className="text-lg font-semibold text-fg">Criar sua conta</h1>

      {erro && (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <Campo
        rotulo="Nome de exibicao" valor={nome} aoMudar={setNome}
        autoComplete="nickname" referencia={campoNome} obrigatorio
        erro={campos['displayName']?.[0]}
      />
      <Campo
        rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
        autoComplete="email" referencia={campoEmail} obrigatorio
        erro={campos['email']?.[0]}
      />
      <Campo
        rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha}
        autoComplete="new-password" obrigatorio
        dica="Ao menos 12 caracteres. Uma frase que so voce saberia funciona melhor que simbolos."
        erro={campos['password']?.[0]}
      />

      <Botao type="submit" disabled={enviando}>
        {enviando ? 'Criando...' : 'Criar conta e entrar'}
      </Botao>
    </form>
  )
}
