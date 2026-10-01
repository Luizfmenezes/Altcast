import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, Search, Users } from 'lucide-react'
import { canalSilenciado } from '../../lib/atencao.js'
import { definirConversaNaTela } from '../../lib/notificacoes.js'
import { MOSTRAR_CANAL } from '../../lib/instalacao.js'
import { lerRota } from '../../lib/rota.js'
import { ehConversa, possoNoGrupo, useStore } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'
import { Conversa } from '../channels/Conversa.js'
import { ListaConversas } from '../conversas/ListaConversas.js'
import { PaletaDeComandos } from '../busca/PaletaDeComandos.js'
import { CartaoDePerfil } from '../presence/CartaoDePerfil.js'
import { PainelMembros } from '../presence/PainelMembros.js'
import { BarraConexao } from '../presence/BarraConexao.js'
import { FaixaDeNotificacoes } from '../presence/FaixaDeNotificacoes.js'
import { FaixaDeVerificacao } from '../auth/FaixaDeVerificacao.js'
import { BarraDeChamada } from '../voice/BarraDeChamada.js'
import { Configuracoes } from '../settings/Configuracoes.js'
import { PERMISSOES_DE_ADMINISTRACAO } from '../settings/ConfiguracoesGrupo.js'
import { BarraDeAbas, type AbaMovel } from './BarraDeAbas.js'
import { InicioMovel } from './InicioMovel.js'
import { GrupoMovel } from './GrupoMovel.js'
import { VoceMovel } from './VoceMovel.js'

/** Em que tela a pessoa esta: as abas, dentro de um grupo, ou numa conversa. */
type Vista = 'abas' | 'grupo' | 'canal'

/** O atalho do app instalado (`/?aba=conversas`) abre direto na aba certa. */
function abaInicial(): AbaMovel {
  if (typeof window === 'undefined') return 'inicio'
  return new URLSearchParams(window.location.search).get('aba') === 'conversas' ? 'conversas' : 'inicio'
}

const ENTRADA = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: { duration: 0.18, ease: [0.2, 0, 0, 1] as const },
}

/**
 * O Altcast no celular.
 *
 * As quatro colunas do desktop nao encolhem ate 390px — elas viram TELAS, uma
 * por vez, como em todo app de conversa: as abas (Inicio, Conversas, Voce), o
 * grupo com seus canais, e a conversa em tela cheia. A store e a mesma, os
 * componentes de conversa sao os mesmos; so a navegacao e outra.
 *
 * O Voltar do Android (e o gesto de voltar) desce um nivel em vez de sair do
 * app: ele chega como `popstate`, e e por ele que a pilha anda para tras.
 */
export function ShellMovel({ campoEscrita, aoDigitar, latenciaMs }: {
  campoEscrita: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
  latenciaMs: number | null
}): ReactNode {
  const [aba, setAba] = useState<AbaMovel>(abaInicial)
  const [vista, setVista] = useState<Vista>(() => (lerRota().nome === 'canal' ? 'canal' : 'abas'))
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [membrosAbertos, setMembrosAbertos] = useState(false)

  const canalAtivo = useStore(e => e.canalAtivo)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const channels = useStore(e => e.channels)
  const groups = useStore(e => e.groups)
  const naoLidas = useStore(e => e.naoLidas)
  const preferencias = useStore(e => e.preferencias)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const administra = useStore(e => grupoAtivo !== null
    && PERMISSOES_DE_ADMINISTRACAO.some(acao => possoNoGrupo(e, grupoAtivo, acao)))

  // A vista corrente num ref, para `voltar` ler sem se recriar a cada troca —
  // ele e o ouvinte do `popstate`, e trocar o ouvinte a cada tela seria
  // perder um Voltar no meio da troca.
  const vistaAtual = useRef(vista)
  vistaAtual.current = vista

  /**
   * De onde a conversa foi aberta. Voltar leva exatamente para la — o grupo,
   * ou a aba (Inicio, Conversas) — e nao para um lugar deduzido da store, que
   * o proprio Voltar ja mudou: o `popstate` troca a rota, a rota troca o
   * canal, e quando este codigo pergunta "de onde vim" a resposta ja e outra.
   */
  const deOnde = useRef<Vista>('abas')

  /**
   * Sobe um nivel. Escreve o ref NA HORA, e nao so no proximo render: dois
   * Voltar seguidos antes de a tela redesenhar subiriam dois niveis.
   */
  const irPara = useCallback((destino: Vista): void => {
    vistaAtual.current = destino
    setVista(destino)
  }, [])

  const voltar = useCallback((): void => {
    setMembrosAbertos(false)
    irPara(vistaAtual.current === 'canal' && deOnde.current === 'grupo' ? 'grupo' : 'abas')
  }, [irPara])

  /**
   * Descer uma tela EMPILHA uma entrada no historico, com o mesmo endereco.
   * Sem ela, o Voltar do Android (que so conhece o historico) fecharia o app
   * de dentro de uma conversa, em vez de voltar a lista.
   */
  const avancar = useCallback((destino: Vista): void => {
    if (vistaAtual.current === destino) return
    if (destino === 'canal') deOnde.current = vistaAtual.current
    history.pushState({ movel: destino }, '')
    irPara(destino)
  }, [irPara])

  /** O botao de voltar da tela: gasta a entrada que `avancar` empilhou, se houver. */
  const recuar = useCallback((): void => {
    const estado = history.state as { movel?: Vista } | null
    if (estado?.movel !== undefined) history.back()
    else voltar()
  }, [voltar])

  /**
   * Abrir uma conversa de qualquer lugar — o "Enviar mensagem" do cartao de
   * perfil, a conversa nova que acabou de chegar pelo socket — leva a tela
   * ate ela. E a troca de GRUPO ativo para uma conversa que decide, e nao o
   * clique: a conversa nova so existe quando o evento chega.
   */
  const grupoAnterior = useRef(grupoAtivo)
  /**
   * A troca veio do HISTORICO (Voltar/Avancar)? Entao nao e alguem abrindo
   * uma conversa, e o endereco antigo restaurado nao pode reabri-la por cima
   * da lista para onde a pessoa acabou de voltar.
   */
  const vindoDoHistorico = useRef(false)
  useEffect(() => {
    const antes = grupoAnterior.current
    grupoAnterior.current = grupoAtivo
    if (grupoAtivo === null || antes === grupoAtivo || vindoDoHistorico.current) return
    if (ehConversa(useStore.getState().groups.find(g => g.id === grupoAtivo))) avancar('canal')
  }, [grupoAtivo, avancar])

  useEffect(() => {
    // Em captura: dispara antes do ouvinte da rota, que ja troca o canal.
    const marcar = (): void => {
      vindoDoHistorico.current = true
      setTimeout(() => { vindoDoHistorico.current = false }, 100)
    }
    window.addEventListener('popstate', marcar, { capture: true })
    window.addEventListener('popstate', voltar)
    // Notificacao clicada: a URL ja aponta para o canal, falta mostra-lo.
    const mostrar = (): void => irPara('canal')
    window.addEventListener(MOSTRAR_CANAL, mostrar)
    return () => {
      window.removeEventListener('popstate', marcar, { capture: true })
      window.removeEventListener('popstate', voltar)
      window.removeEventListener(MOSTRAR_CANAL, mostrar)
    }
  }, [voltar, irPara])

  // So a tela de conversa conta como "olhando o canal" para calar avisos.
  useEffect(() => {
    definirConversaNaTela(vista === 'canal')
    return () => definirConversaNaTela(true)
  }, [vista])

  const abrirGrupo = (groupId: string): void => {
    escolherGrupo(groupId)
    avancar('grupo')
  }

  const conversa = new Set(groups.filter(g => ehConversa(g) && g.hidden !== true).map(g => g.id))
  const grupoComum = new Set(groups.filter(g => !ehConversa(g)).map(g => g.id))
  const contagem = { inicio: 0, conversas: 0 }
  for (const c of channels) {
    const n = naoLidas[c.id]?.n ?? 0
    if (n === 0) continue
    if (conversa.has(c.groupId)) contagem.conversas += n
    else if (grupoComum.has(c.groupId) && !canalSilenciado({ preferencias }, c)) contagem.inicio += n
  }

  const sobreposicoes = (
    <>
      <PaletaDeComandos
        aberta={buscaAberta}
        aoFechar={() => {
          setBuscaAberta(false)
          // A paleta escolhe canal e grupo direto na store: se escolheu,
          // e para ver.
          if (useStore.getState().canalAtivo !== canalAtivo) avancar('canal')
        }}
      />
      <CartaoDePerfil />
      <Configuracoes groupId={grupoAtivo} podeAdministrar={administra} semGatilho />
    </>
  )

  if (vista === 'canal') {
    const direta = ehConversa(groups.find(g => g.id === grupoAtivo))
    return (
      <div
        className="relative flex h-full flex-col overflow-hidden bg-bg"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <a href="#conversa" className="pular-para-conversa">Pular para a conversa</a>
        <Conversa
          key={canalAtivo ?? 'nenhum'}
          campoEscrita={campoEscrita}
          {...(aoDigitar === undefined ? {} : { aoDigitar })}
          antes={
            <Botao variante="fantasma" tamanho="icone" onClick={recuar} className="-ml-1 rounded-xl">
              <ChevronLeft aria-hidden="true" />
              <span className="sr-only">Voltar</span>
            </Botao>
          }
          depois={
            <>
              <Botao variante="fantasma" tamanho="iconeSm" onClick={() => setBuscaAberta(true)}>
                <Search aria-hidden="true" strokeWidth={1.75} />
                <span className="sr-only">Buscar</span>
              </Botao>
              {!direta && (
                <Botao
                  variante="fantasma"
                  tamanho="iconeSm"
                  onClick={() => setMembrosAbertos(a => !a)}
                  aria-expanded={membrosAbertos}
                >
                  <Users aria-hidden="true" strokeWidth={1.75} />
                  <span className="sr-only">{membrosAbertos ? 'Ocultar membros' : 'Mostrar membros'}</span>
                </Botao>
              )}
            </>
          }
        />
        <BarraConexao latenciaMs={latenciaMs} />

        <AnimatePresence>
          {membrosAbertos && (
            <motion.div
              key="membros"
              className="fixed inset-0 z-30 flex justify-end bg-bg/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMembrosAbertos(false)}
            >
              <motion.div
                className="h-full w-[85%] max-w-sm overflow-hidden rounded-l-[28px] shadow-dialog"
                style={{ paddingTop: 'env(safe-area-inset-top)' }}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                onClick={e => e.stopPropagation()}
              >
                <PainelMembros />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {sobreposicoes}
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-bg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <FaixaDeVerificacao />
      <FaixaDeNotificacoes />

      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={vista === 'grupo' ? `grupo:${grupoAtivo ?? ''}` : aba} {...ENTRADA}>
            {vista === 'grupo' ? (
              <GrupoMovel aoVoltar={recuar} aoAbrirCanal={() => avancar('canal')} />
            ) : aba === 'inicio' ? (
              <InicioMovel
                aoAbrirGrupo={abrirGrupo}
                aoAbrirCanal={() => avancar('canal')}
                aoBuscar={() => setBuscaAberta(true)}
              />
            ) : aba === 'conversas' ? (
              <div className="pt-3">
                <ListaConversas variante="movel" aoEscolher={() => {
                  if (useStore.getState().area === 'conversas' && useStore.getState().canalAtivo !== null) {
                    avancar('canal')
                  }
                }} />
              </div>
            ) : (
              <VoceMovel />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* A chamada em curso flutua acima das abas: microfone aberto nunca some da tela. */}
      <div className="px-3 pb-2 empty:hidden [&>*]:overflow-hidden [&>*]:rounded-[20px] [&>*]:border [&>*]:border-border-subtle">
        <BarraDeChamada aoAbrir={() => avancar('canal')} />
      </div>
      <BarraConexao latenciaMs={latenciaMs} />
      <BarraDeAbas
        aba={aba}
        naoLidas={contagem}
        aoTrocar={nova => {
          setVista('abas')
          setAba(nova)
        }}
      />
      {sobreposicoes}
    </div>
  )
}
