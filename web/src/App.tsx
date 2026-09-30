import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppShell } from './AppShell.js'
import { TelaAuth } from './features/auth/TelaAuth.js'
import { AceitarConvite } from './features/groups/AceitarConvite.js'
import { trocarPor, usarRota } from './lib/rota.js'
import { useRotaDoCanal } from './lib/rotaDoCanal.js'
import { Porta } from './features/auth/PalcoMercurio.js'
import { VerificarEmail } from './features/auth/VerificarEmail.js'
import { RedefinirSenha } from './features/auth/RedefinirSenha.js'
import { api, SESSAO_EXPIROU } from './lib/api.js'
import { conectarSocket, type Conexao } from './lib/socket.js'
import { canaisComHistorico, useStore } from './lib/store.js'
import { cueDeEvento } from './features/voice/cues.js'
import type { Mensagem, Ready, Usuario } from './lib/tipos.js'
import { avisarAtencaoSugerida, avisarMensagem, useIndicadorDeAtencao } from './lib/notificacoes.js'
import { useOciosidade } from './lib/ociosidade.js'
import { carregarHistorico } from './features/messages/historico.js'

type Sessao = 'verificando' | 'fora' | 'dentro'

/**
 * Raiz da aplicacao: decide entre a porta de entrada e o produto, mantem o
 * socket vivo e carrega o historico do canal aberto.
 *
 * O socket e um acelerador; a verdade mora no REST. Por isso todo canal aberto
 * busca o proprio historico por HTTP, e a reconexao pergunta o que perdeu -
 * nao existe replay do lado do servidor.
 */
export function App(): ReactNode {
  const [sessao, setSessao] = useState<Sessao>('verificando')
  // A rota e lida DENTRO da sessao tambem, e nao so fora dela. Ate aqui apenas
  // `TelaAuth` a consultava, e por isso um link de convite aberto por quem ja
  // tinha sessao era descartado em silencio: a pessoa caia no aplicativo e o
  // codigo sumia.
  const rota = usarRota()
  const [latencia, setLatencia] = useState<number | null>(null)

  const canalAtivo = useStore(e => e.canalAtivo)
  const aplicarEvento = useStore(e => e.aplicarEvento)
  const aplicarReady = useStore(e => e.aplicarReady)
  const definirConexao = useStore(e => e.definirConexao)
  const limpar = useStore(e => e.limpar)
  const definirEnvio = useStore(e => e.definirEnvio)

  const conexao = useRef<Conexao | null>(null)
  const enviadoEm = useRef(0)

  /** Uma sessao viva devolve o usuario; qualquer outra coisa e a tela de login. */
  useEffect(() => {
    api.get<{ user: Usuario }>('/auth/me')
      .then(() => setSessao('dentro'))
      .catch(() => setSessao('fora'))
  }, [])

  // Sessao morta em qualquer requisicao devolve a pessoa ao login uma unica
  // vez, sem empilhar avisos.
  useEffect(() => {
    const aoExpirar = (): void => {
      limpar()
      setSessao('fora')
    }
    window.addEventListener(SESSAO_EXPIROU, aoExpirar)
    return () => window.removeEventListener(SESSAO_EXPIROU, aoExpirar)
  }, [limpar])

  useEffect(() => {
    if (sessao !== 'dentro') return

    conexao.current = conectarSocket({
      canaisAbertos: canaisComHistorico,
      onStatus: estado => {
        definirConexao(estado)
        if (estado !== 'conectado') setLatencia(null)
      },
      onEvent: evento => {
        if (evento.t === 'ready') return aplicarReady(evento.d as Ready)
        if (evento.t === 'ping') {
          // O ida e volta do heartbeat e a unica medida honesta de latencia
          // que o cliente tem: e o mesmo caminho que as mensagens percorrem.
          enviadoEm.current = Date.now()
          return
        }
        if (evento.t === 'pong') {
          setLatencia(Date.now() - enviadoEm.current)
          return
        }
        aplicarEvento(evento)
        // DEPOIS de aplicar: o som acompanha a lista que a pessoa acabou de
        // ver mudar. E so aqui, porque este e o unico lugar do sistema onde
        // "veio do servidor" e um fato estrutural — e nao uma suposicao.
        cueDeEvento(evento)
        if (evento.t === 'message.created') avisarMensagem(evento.d as Mensagem)
        if (evento.t === 'attention.suggested') {
          avisarAtencaoSugerida(evento.d as { channelId: string; messageId: string })
        }
      },
    })

    // A chamada de voz nasce fundo na arvore e precisa falar com o socket que
    // vive aqui. Passar o `enviar` pela store evita atravessar cinco
    // componentes com uma propriedade que nenhum deles usa.
    definirEnvio(quadro => conexao.current?.enviar(quadro) ?? false)

    return () => {
      conexao.current?.fechar()
      conexao.current = null
      definirEnvio(() => false)
    }
  }, [sessao, aplicarEvento, aplicarReady, definirConexao, definirEnvio])

  // Abrir um canal carrega o historico dele por REST. O socket so acrescenta
  // o que chegar depois.
  useEffect(() => {
    if (sessao !== 'dentro' || canalAtivo === null) return
    return carregarHistorico(canalAtivo)
  }, [sessao, canalAtivo])

  const entrou = useCallback(() => setSessao('dentro'), [])

  // O canal aberto vive na URL (links diretos, Voltar do navegador).
  useRotaDoCanal(rota, sessao === 'dentro')
  // Titulo, favicon e icone do app contam as mencoes e as nao lidas.
  useIndicadorDeAtencao(sessao === 'dentro')
  // Dez minutos sem uso: os outros passam a ver "ausente".
  useOciosidade(sessao === 'dentro')

  /**
   * Com sessao, os enderecos da porta nao significam mais nada.
   *
   * Entrar deixava `/entrar` na barra: um F5 depois do login mostrava o
   * aplicativo num endereco que diz "tela de login", e o Voltar do navegador
   * levava de volta a um formulario que ja nao tinha funcao.
   */
  useEffect(() => {
    if (sessao !== 'dentro') return
    const daPorta = (rota.nome === 'entrar' || rota.nome === 'criar-conta')
      ? rota.convite === undefined
      : rota.nome === 'esqueci-a-senha'
    if (daPorta) trocarPor({ nome: 'app' })
  }, [sessao, rota])

  if (sessao === 'verificando') {
    // Esqueleto silencioso: piscar o login para quem ja tem sessao seria pior
    // do que esperar duzentos milissegundos.
    return <div aria-busy="true" className="h-full bg-bg" />
  }

  if (sessao === 'fora') {
    // A rota agora vive em lib/rota.ts: alem do convite, ela precisa reconhecer
    // os links de recuperacao e de confirmacao que chegam por e-mail.
    return <TelaAuth aoEntrar={entrou} />
  }

  /**
   * Os links de e-mail tambem valem com sessao aberta.
   *
   * Confirmar o endereco no mesmo navegador em que ja se esta logado e o caso
   * MAIS comum, e ele era ignorado: `/verificar/<token>` caia direto no
   * aplicativo, o token nunca era gasto e a faixa de "confirme seu e-mail"
   * continuava pedindo o que a pessoa acabara de fazer.
   */
  if (rota.nome === 'verificar') {
    return <Porta><VerificarEmail token={rota.token} comSessao /></Porta>
  }
  if (rota.nome === 'redefinir') {
    return <Porta><RedefinirSenha token={rota.token} /></Porta>
  }

  // Convite trazido pela porta de entrada: quem clicou em "Entrar" com o
  // cartao do grupo na tela ja decidiu, e o aplicativo aceita sozinho.
  const conviteDaPorta = (rota.nome === 'entrar' || rota.nome === 'criar-conta')
    ? rota.convite
    : undefined

  return (
    <>
      <AppShell latenciaMs={latencia} />
      {rota.nome === 'convite' && <AceitarConvite codigo={rota.codigo} />}
      {conviteDaPorta !== undefined && (
        <AceitarConvite key={conviteDaPorta} codigo={conviteDaPorta} automatico />
      )}
    </>
  )
}
