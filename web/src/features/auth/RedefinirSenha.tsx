import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { TituloDaPorta } from './PalcoMercurio.js'
import { irPara, trocarPor } from '../../lib/rota.js'

/**
 * Escolha da senha nova, a partir do link do e-mail.
 *
 * Ao terminar, a rota e trocada por `replaceState` e nao por `pushState`: o
 * token ja foi gasto, e deixar `/redefinir/<token>` no historico convidaria o
 * botao Voltar a levar de volta a um link morto — alem de manter a credencial
 * a mostra na barra de enderecos.
 */
export function RedefinirSenha({ token }: { token: string }): ReactNode {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string[]>>({})
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setCampos({})
    setEnviando(true)
    try {
      await api.post('/auth/reset-password', { token, password: senha })
      setPronto(true)
      trocarPor({ nome: 'entrar' })
    } catch (e) {
      const apiErro = e instanceof ApiError ? e : null
      setErro(apiErro?.message ?? 'Nao foi possivel redefinir. Tente novamente.')
      setCampos(apiErro?.camposInvalidos ?? {})
      campo.current?.focus()
    } finally {
      setEnviando(false)
    }
  }

  if (pronto) {
    return (
      <>
        <TituloDaPorta titulo={<>SENHA<br />TROCADA</>} />
        <p role="status" className="text-sm leading-relaxed text-fg-muted">
          Todas as sessoes abertas foram encerradas — inclusive as de quem quer que
          tivesse a senha antiga. Entre com a nova.
        </p>
        <div className="mt-6">
          <Botao tamanho="lg" largura="cheia" onClick={() => irPara({ nome: 'entrar' })}>
            Entrar
          </Botao>
        </div>
      </>
    )
  }

  return (
    <>
      <TituloDaPorta
        titulo={<>NOVA<br />SENHA</>}
        subtitulo="Este link vale uma vez so."
      />

      {erro !== null && (
        <p role="alert" className="mb-5 rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <form onSubmit={enviar} className="campos-da-porta flex flex-col gap-5" noValidate>
        <Campo
          rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha}
          aparencia="linha" autoComplete="new-password" referencia={campo} obrigatorio
          dica="Ao menos 12 caracteres. Uma frase que so voce saberia funciona melhor que simbolos."
          erro={campos['password']?.[0]}
        />
        <div className="envio-da-porta">
          <span className="gota" aria-hidden="true" />
          <Botao type="submit" tamanho="lg" largura="cheia" disabled={enviando}>
            {enviando ? 'Trocando...' : 'Trocar senha'}
          </Botao>
        </div>
      </form>

      <nav className="rodape-da-porta">
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'esqueci-a-senha' })}>
          Pedir outro link
        </button>
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'entrar' })}>
          Voltar
        </button>
      </nav>
    </>
  )
}
