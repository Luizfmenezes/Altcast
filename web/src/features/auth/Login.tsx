import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api, rearmarAvisoDeSessao } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { TituloDaPorta } from './PalcoMercurio.js'
import { EntrarComGoogle } from './EntrarComGoogle.js'
import { irPara } from '../../lib/rota.js'
import type { Usuario } from '../../lib/tipos.js'

export type { Usuario }

/**
 * A falha da entrada pelo Google chega pela URL, e nao por uma resposta.
 *
 * O callback e uma navegacao de servidor: quem chega aqui depois de um erro
 * chegou por `Location:`, nao por `fetch`. Sem este aviso, a pessoa voltaria
 * para o login sem nenhuma explicacao de por que nao entrou.
 */
function erroDaUrl(): string | null {
  const q = new URLSearchParams(window.location.search).get('erro')
  if (q === 'google') {
    return 'Nao foi possivel entrar pelo Google. Tente de novo ou use sua senha.'
  }
  if (q === 'google_indisponivel') {
    return 'A entrada pelo Google nao esta configurada neste servidor.'
  }
  return null
}

export function Login({ aoEntrar }: { aoEntrar: (u: Usuario) => void }): ReactNode {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(erroDaUrl)
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
    <>
      <TituloDaPorta titulo={<>ALT<br />CAST</>} subtitulo="Entrar no Altcast" />

      {erro !== null && (
        <p role="alert" className="mb-5 rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <form onSubmit={enviar} className="campos-da-porta flex flex-col gap-5" noValidate>
        <Campo
          rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
          aparencia="linha" autoComplete="email" referencia={campoEmail} obrigatorio
        />
        <Campo
          rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha}
          aparencia="linha" autoComplete="current-password" obrigatorio
        />

        <div className="envio-da-porta">
          <span className="gota" aria-hidden="true" />
          <Botao type="submit" tamanho="lg" largura="cheia" disabled={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </Botao>
        </div>
      </form>

      <EntrarComGoogle rotulo="Entrar com Google" />

      <nav className="rodape-da-porta">
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'esqueci-a-senha' })}>
          Esqueci minha senha
        </button>
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'criar-conta' })}>
          Criar conta
        </button>
      </nav>
    </>
  )
}
