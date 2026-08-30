import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { TituloDaPorta } from './PalcoMercurio.js'
import { irPara } from '../../lib/rota.js'

/**
 * Pedido de recuperacao.
 *
 * A tela NUNCA diz se o endereco existe. O servidor responde 204 para os dois
 * casos, e a interface precisa contar a mesma historia: uma mensagem diferente
 * aqui desfaria, num paragrafo, a protecao que a rota inteira foi escrita para
 * ter.
 */
export function EsqueciASenha(): ReactNode {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setEnviando(true)
    try {
      await api.post('/auth/forgot-password', { email })
    } catch {
      // Falha de rede tambem cai aqui, e tambem nao vira mensagem distinta:
      // pedir de novo e o caminho para os dois casos.
    } finally {
      setEnviando(false)
      setEnviado(true)
    }
  }

  if (enviado) {
    return (
      <>
        <TituloDaPorta titulo={<>VERIFIQUE<br />SEU E-MAIL</>} />
        <p role="status" className="text-sm leading-relaxed text-fg-muted">
          Se houver uma conta em <strong className="text-fg">{email}</strong>, o link
          de recuperacao chega em instantes. Ele vale por uma hora.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Botao variante="discreto" largura="cheia" onClick={() => setEnviado(false)}>
            Usar outro e-mail
          </Botao>
          <Botao variante="fantasma" largura="cheia" onClick={() => irPara({ nome: 'entrar' })}>
            Voltar para entrar
          </Botao>
        </div>
      </>
    )
  }

  return (
    <>
      <TituloDaPorta
        titulo={<>RECUPERAR<br />ACESSO</>}
        subtitulo="Mandamos um link para voce escolher uma senha nova."
      />
      <form onSubmit={enviar} className="campos-da-porta flex flex-col gap-5" noValidate>
        <Campo
          rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
          aparencia="linha" autoComplete="email" referencia={campo} obrigatorio
        />
        <div className="envio-da-porta">
          <span className="gota" aria-hidden="true" />
          <Botao type="submit" tamanho="lg" largura="cheia" disabled={enviando}>
            {enviando ? 'Enviando...' : 'Enviar link'}
          </Botao>
        </div>
      </form>

      <nav className="rodape-da-porta">
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'entrar' })}>
          Ja lembrei a senha
        </button>
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'criar-conta' })}>
          Criar conta
        </button>
      </nav>
    </>
  )
}
