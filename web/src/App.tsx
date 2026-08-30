import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppShell } from './AppShell.js'
import { TelaAuth } from './features/auth/TelaAuth.js'
import { api, SESSAO_EXPIROU } from './lib/api.js'
import { conectarSocket, type Conexao } from './lib/socket.js'
import { canaisComHistorico, useStore } from './lib/store.js'
import type { Mensagem, Ready, Usuario } from './lib/tipos.js'

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
  const [latencia, setLatencia] = useState<number | null>(null)

  const canalAtivo = useStore(e => e.canalAtivo)
  const aplicarEvento = useStore(e => e.aplicarEvento)
  const aplicarReady = useStore(e => e.aplicarReady)
  const definirConexao = useStore(e => e.definirConexao)
  const carregarMensagens = useStore(e => e.carregarMensagens)
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
    let vigente = true
    api.get<Mensagem[]>(`/channels/${canalAtivo}/messages?limit=50`)
      .then(pagina => {
        // A API devolve do mais novo para o mais antigo; a lista exibe ao
        // contrario.
        if (vigente) carregarMensagens(canalAtivo, [...pagina].reverse())
      })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [sessao, canalAtivo, carregarMensagens])

  const entrou = useCallback(() => setSessao('dentro'), [])

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

  return <AppShell latenciaMs={latencia} />
}
