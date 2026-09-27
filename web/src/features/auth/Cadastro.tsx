import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, api, rearmarAvisoDeSessao } from '../../lib/api.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { TituloDaPorta } from './PalcoMercurio.js'
import { EntrarComGoogle } from './EntrarComGoogle.js'
import { irPara, trocarPor } from '../../lib/rota.js'
import { PreviaConvite } from './PreviaConvite.js'
import type { Usuario } from '../../lib/tipos.js'

/**
 * Criacao de conta.
 *
 * O codigo de convite virou opcional junto com a abertura do cadastro. Com
 * codigo, a conta ja nasce dentro do grupo; sem codigo, nasce sozinha e a
 * pessoa cria o proprio grupo ou aceita um convite depois.
 *
 * O que a lista de convidados garantia passou a ser trabalho da confirmacao de
 * e-mail — que e o que libera criar grupo e emitir convite.
 */
export function Cadastro({ codigo, aoEntrar }: {
  codigo?: string | undefined
  aoEntrar: (u: Usuario) => void
}): ReactNode {
  const [nome, setNome] = useState('')
  /**
   * O e-mail do convite ja vem preenchido.
   *
   * Nao e so comodidade: o convite dirigido a um endereco so e resgatado no
   * cadastro se a conta nascer com AQUELE endereco. Quem digitasse outro
   * entraria sem o grupo e sem entender por que — o convite continuaria
   * pendente, enderecado a um endereco que ele nao usa mais.
   */
  const [email, setEmail] = useState(
    () => new URLSearchParams(window.location.search).get('email') ?? '',
  )
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
        email, password: senha, displayName: nome,
        ...(codigo === undefined ? {} : { inviteCode: codigo }),
      })
      rearmarAvisoDeSessao()
      // A conta nasceu dentro do grupo, mas o endereco ainda e o do convite.
      // Trocar por `entrar?convite=` entrega ao aplicativo o codigo como
      // "acabou de ser aceito": ele abre o grupo direto, em vez de perguntar
      // "Entrar em Clube do Livro?" a quem ja esta la dentro.
      if (codigo !== undefined) trocarPor({ nome: 'entrar', convite: codigo })
      aoEntrar(user)
    } catch (e) {
      const apiErro = e instanceof ApiError ? e : null
      setErro(apiErro?.message ?? 'Não foi possível criar a conta. Tente novamente.')
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
    <>
      <TituloDaPorta
        titulo={<>CRIAR<br />CONTA</>}
        subtitulo={codigo === undefined
          ? 'Leva menos de um minuto.'
          : 'Você entra direto no grupo do convite.'}
      />

      {codigo !== undefined && <PreviaConvite codigo={codigo} />}

      {erro !== null && (
        <p role="alert" className="mb-5 rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <form onSubmit={enviar} className="campos-da-porta flex flex-col gap-5" noValidate>
        <Campo
          rotulo="Nome de exibição" valor={nome} aoMudar={setNome}
          aparencia="linha" autoComplete="nickname" referencia={campoNome} obrigatorio
          erro={campos['displayName']?.[0]}
        />
        <Campo
          rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
          aparencia="linha" autoComplete="email" referencia={campoEmail} obrigatorio
          erro={campos['email']?.[0]}
        />
        <Campo
          rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha}
          aparencia="linha" autoComplete="new-password" obrigatorio
          dica="Ao menos 12 caracteres. Uma frase que só você saberia funciona melhor que símbolos."
          erro={campos['password']?.[0]}
        />

        <div className="envio-da-porta">
          <Botao type="submit" tamanho="lg" largura="cheia" disabled={enviando}>
            {enviando ? 'Criando…' : 'Criar conta e entrar'}
          </Botao>
        </div>
      </form>

      <EntrarComGoogle rotulo="Criar conta com Google" convite={codigo} />

      <nav className="rodape-da-porta">
        <button type="button" className="text-fg-muted hover:text-fg"
          onClick={() => irPara({ nome: 'entrar', ...(codigo === undefined ? {} : { convite: codigo }) })}>
          Já tenho conta
        </button>
      </nav>
    </>
  )
}
