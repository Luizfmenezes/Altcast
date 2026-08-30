import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api } from '../../lib/api.js'
import { Botao } from '../../ui/Botao.js'
import { TituloDaPorta } from './PalcoMercurio.js'
import { irPara, trocarPor } from '../../lib/rota.js'

type Fase = 'confirmando' | 'pronto' | 'falhou'

/**
 * Confirmacao do endereco, a partir do link do e-mail.
 *
 * Confirma sozinha ao abrir, sem botao: quem clicou no link do e-mail ja
 * declarou a intencao, e pedir um segundo clique so acrescenta um passo entre
 * a pessoa e o que ela veio fazer.
 *
 * A rota nao exige sessao, e isso e o que faz o link funcionar no celular onde
 * ninguem entrou ainda.
 */
export function VerificarEmail({ token }: { token: string }): ReactNode {
  const [fase, setFase] = useState<Fase>('confirmando')
  const [erro, setErro] = useState<string | null>(null)
  // O StrictMode monta duas vezes em desenvolvimento, e o token e de uso
  // unico: sem esta trava a segunda montagem consumiria um link ja gasto e
  // mostraria um erro que nao existe.
  const jaTentou = useRef(false)

  useEffect(() => {
    if (jaTentou.current) return
    jaTentou.current = true

    api.post('/auth/verify-email', { token })
      .then(() => {
        setFase('pronto')
        trocarPor({ nome: 'entrar' })
      })
      .catch((e: unknown) => {
        setErro(e instanceof ApiError ? e.message : 'Nao foi possivel confirmar agora.')
        setFase('falhou')
      })
  }, [token])

  if (fase === 'confirmando') {
    return (
      <>
        <TituloDaPorta titulo={<>CONFIRMANDO<br />ENDERECO</>} />
        <p role="status" aria-busy="true" className="text-sm text-fg-muted">
          Um instante.
        </p>
      </>
    )
  }

  if (fase === 'pronto') {
    return (
      <>
        <TituloDaPorta titulo={<>E-MAIL<br />CONFIRMADO</>} />
        <p role="status" className="text-sm leading-relaxed text-fg-muted">
          Pronto. Agora voce pode criar grupos e convidar gente.
        </p>
        <div className="mt-6">
          <Botao tamanho="lg" largura="cheia" onClick={() => irPara({ nome: 'entrar' })}>
            Continuar
          </Botao>
        </div>
      </>
    )
  }

  return (
    <>
      <TituloDaPorta titulo={<>LINK<br />VENCIDO</>} />
      <p role="alert" className="text-sm leading-relaxed text-danger">{erro}</p>
      <p className="mt-3 text-sm leading-relaxed text-fg-muted">
        Entre na sua conta e peca um link novo pelas configuracoes.
      </p>
      <div className="mt-6">
        <Botao tamanho="lg" largura="cheia" onClick={() => irPara({ nome: 'entrar' })}>
          Entrar
        </Botao>
      </div>
    </>
  )
}
