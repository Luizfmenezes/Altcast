import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from './lib/store.js'
import {
  LARGURA_CANAIS_FIXOS, LARGURA_MEMBROS_FIXOS, usaLarguraMinima,
} from './lib/pontosDeQuebra.js'
import { BarraGrupos } from './features/groups/BarraGrupos.js'
import { ListaCanais } from './features/channels/ListaCanais.js'
import { Conversa } from './features/channels/Conversa.js'
import { PainelMembros } from './features/presence/PainelMembros.js'
import { BarraConexao } from './features/presence/BarraConexao.js'
import { BarraDeChamada } from './features/voice/BarraDeChamada.js'
import { registrarSaidaDaAba } from './features/voice/chamadaAtiva.js'
import { useAtalhosDaChamada } from './features/voice/atalhos.js'

/**
 * Quatro colunas: 64px, 240px, flexivel, 240px. As larguras sao fixas onde
 * precisam ser estaveis, e a coluna de conversa fica com o resto.
 *
 * Abaixo de 640px a lista de canais sai da arvore e reaparece numa gaveta;
 * abaixo de 1200px o painel de membros faz o mesmo. Sair da arvore, e nao
 * apenas sumir por CSS, e o que impede o leitor de tela de anunciar uma
 * navegacao que ninguem consegue ver.
 */
export function AppShell({ aoDigitar, latenciaMs }: {
  aoDigitar?: () => void
  latenciaMs?: number | null
} = {}): ReactNode {
  const channels = useStore(e => e.channels)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const canalAtivo = useStore(e => e.canalAtivo)
  const escolherCanal = useStore(e => e.escolherCanal)

  const canaisFixos = usaLarguraMinima(LARGURA_CANAIS_FIXOS)
  const membrosFixos = usaLarguraMinima(LARGURA_MEMBROS_FIXOS)

  const [gavetaCanais, setGavetaCanais] = useState(false)
  const [membrosVisiveis, setMembrosVisiveis] = useState(false)
  const campoEscrita = useRef<HTMLTextAreaElement>(null)

  const doGrupo = channels.filter(c => c.groupId === grupoAtivo)

  // A primeira renderizacao nao move o foco: roubar o foco de quem acabou de
  // chegar na pagina seria pior do que nao ajudar ninguem.
  const primeiraVez = useRef(true)
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    campoEscrita.current?.focus()
  }, [canalAtivo])

  /** Alt com seta anda pela lista e para nas pontas, em vez de dar a volta. */
  const navegar = useCallback((passo: number) => {
    const indice = doGrupo.findIndex(c => c.id === canalAtivo)
    const destino = doGrupo[Math.min(Math.max(indice + passo, 0), doGrupo.length - 1)]
    if (destino && destino.id !== canalAtivo) escolherCanal(destino.id)
  }, [doGrupo, canalAtivo, escolherCanal])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (!evento.altKey) return
      if (evento.key === 'ArrowDown') { evento.preventDefault(); navegar(1) }
      if (evento.key === 'ArrowUp') { evento.preventDefault(); navegar(-1) }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [navegar])

  /**
   * A chamada nao morre mais no desmonte de um componente — ela sobrevive a
   * navegacao de proposito. Fechar a ABA, porem, continua tendo de derruba-la:
   * e o unico caso em que nenhuma interface pode avisar, porque nao ha mais
   * interface nenhuma.
   */
  useEffect(registrarSaidaDaAba, [])

  // `M` muda, `D` ensurdece, e a tecla de push-to-talk abre o microfone
  // enquanto pressionada. Ficam no shell, e nao no painel de voz, porque a
  // chamada agora sobrevive a navegacao: um atalho que so funcionasse com o
  // canal da chamada aberto seria inutil justamente quando mais se precisa
  // dele.
  useAtalhosDaChamada()

  // Esc fecha a sobreposicao vigente, sempre.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return
      setGavetaCanais(false)
      if (!membrosFixos) setMembrosVisiveis(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [membrosFixos])

  return (
    <div className="flex h-full flex-col">
      {/* Primeiro elemento focavel da aplicacao. */}
      <a href="#conversa" className="pular-para-conversa">Pular para a conversa</a>

      <div className="flex min-h-0 flex-1">
        <BarraGrupos />

        {canaisFixos ? (
          <nav
            aria-label="Canais do grupo"
            className="shrink-0 overflow-y-auto border-r border-border-subtle bg-bg-raised"
            style={{ width: 'var(--w-channels)' }}
          >
            <ListaCanais />
          </nav>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setGavetaCanais(true)}
              className="absolute left-16 top-2 z-10 rounded border border-border bg-bg-raised
                         px-2 py-1 text-xs text-fg"
            >
              Abrir canais
            </button>
            {gavetaCanais && (
              <nav
                aria-label="Canais do grupo"
                className="absolute inset-y-0 left-16 z-20 overflow-y-auto border-r
                           border-border bg-bg-raised shadow-lg"
                style={{ width: 'var(--w-channels)' }}
              >
                <ListaCanais aoEscolher={() => setGavetaCanais(false)} />
              </nav>
            )}
          </>
        )}

        <Conversa campoEscrita={campoEscrita} {...(aoDigitar === undefined ? {} : { aoDigitar })} />

        {membrosFixos || membrosVisiveis ? (
          <PainelMembros />
        ) : (
          <button
            type="button"
            onClick={() => setMembrosVisiveis(true)}
            className="absolute right-2 top-2 z-10 rounded border border-border bg-bg-raised
                       px-2 py-1 text-xs text-fg"
          >
            Mostrar membros
          </button>
        )}
      </div>

      <BarraDeChamada />
      <BarraConexao latenciaMs={latenciaMs ?? null} />
    </div>
  )
}
