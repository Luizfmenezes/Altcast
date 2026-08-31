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
import { ProvedorDeDicas, Dica } from './ui/Tooltip.js'
import { PanelLeftClose, PanelLeftOpen, Search, Users } from 'lucide-react'
import { PaletaDeComandos } from './features/busca/PaletaDeComandos.js'
import { FaixaDeVerificacao } from './features/auth/FaixaDeVerificacao.js'
import { BoasVindas } from './features/groups/BoasVindas.js'
import { Botao } from './ui/Botao.js'
import { Kbd } from './ui/Kbd.js'
import { Avatar } from './ui/Avatar.js'

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
  const [buscaAberta, setBuscaAberta] = useState(false)
  const user = useStore(e => e.user)
  const groups = useStore(e => e.groups)
  const campoEscrita = useRef<HTMLTextAreaElement>(null)

  const doGrupo = channels.filter(c => c.groupId === grupoAtivo)

  /**
   * Trocar de canal leva o foco ao campo de escrita. CHEGAR nao leva.
   *
   * A guarda antiga era um booleano de "primeira renderizacao", e ela nao
   * cobria o caso real: na montagem `canalAtivo` ainda e nulo, o booleano se
   * gasta ali, e quando o `ready` chega e escolhe o primeiro canal a segunda
   * passada ja se considera uma troca — e rouba o foco de quem acabou de abrir
   * a pagina. O sintoma e o link de pular para a conversa, que deixa de ser
   * alcancavel pelo primeiro Tab justamente para quem depende dele.
   *
   * Guardar o canal anterior, e nao um booleano, diz o que se quis dizer: so e
   * troca quando havia um canal antes.
   */
  const canalAnterior = useRef<string | null>(null)
  useEffect(() => {
    const veioDeOutroCanal = canalAnterior.current !== null && canalAnterior.current !== canalAtivo
    canalAnterior.current = canalAtivo
    if (veioDeOutroCanal) campoEscrita.current?.focus()
  }, [canalAtivo])

  /** Alt com seta anda pela lista e para nas pontas, em vez de dar a volta. */
  const navegar = useCallback((passo: number) => {
    const indice = doGrupo.findIndex(c => c.id === canalAtivo)
    const destino = doGrupo[Math.min(Math.max(indice + passo, 0), doGrupo.length - 1)]
    if (destino && destino.id !== canalAtivo) escolherCanal(destino.id)
  }, [doGrupo, canalAtivo, escolherCanal])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      // Ctrl+K no Windows e no Linux, Cmd+K no mac. Vale de qualquer lugar,
      // inclusive de dentro do campo de escrita.
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault()
        setBuscaAberta(a => !a)
        return
      }
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
      setBuscaAberta(false)
      setGavetaCanais(false)
      if (!membrosFixos) setMembrosVisiveis(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [membrosFixos])

  // Conta sem grupo algum so passou a existir quando o cadastro abriu: antes,
  // toda conta nascia dentro do grupo do convite que a criou. Montar as quatro
  // colunas vazias seria entregar um esqueleto sem dizer o que fazer.
  if (groups.length === 0) {
    return (
      <ProvedorDeDicas>
        <div className="flex h-full flex-col">
          <FaixaDeVerificacao />
          <BoasVindas />
        </div>
      </ProvedorDeDicas>
    )
  }

  return (
    // O provedor tambem envolve a raiz em main.tsx; repeti-lo aqui e de
    // proposito. Aninhar dois nao custa nada, e sem este o AppShell so monta
    // dentro da aplicacao inteira — um componente que nao se sustenta sozinho
    // e um componente que nao da para testar isolado.
    <ProvedorDeDicas>
    <div className="flex h-full flex-col">
      {/* Primeiro elemento focavel da aplicacao. */}
      <a href="#conversa" className="pular-para-conversa">Pular para a conversa</a>

      <FaixaDeVerificacao />

      {/* A barra do topo. Ela existe para dar um lugar fixo ao que antes eram
          dois botoes soltos por cima do conteudo, e para responder de relance
          "onde eu estou": grupo, barra, canal. Trunca em vez de empurrar —
          o teste de refluxo em 320px proibe qualquer largura que estoure. */}
      <header
        className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle
                   bg-bg-raised px-2 sm:px-3"
      >
        {!canaisFixos && (
          <Dica texto={gavetaCanais ? 'Fechar canais' : 'Abrir canais'} lado="bottom">
            <Botao
              variante="fantasma"
              tamanho="icone"
              onClick={() => setGavetaCanais(a => !a)}
              aria-expanded={gavetaCanais}
            >
              {gavetaCanais
                ? <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
                : <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />}
              <span className="sr-only">{gavetaCanais ? 'Fechar canais' : 'Abrir canais'}</span>
            </Botao>
          </Dica>
        )}

        <nav aria-label="Onde voce esta" className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-[13px] text-fg-muted">
            {groups.find(g => g.id === grupoAtivo)?.name ?? 'Altcast'}
          </span>
          <span aria-hidden="true" className="text-fg-muted/50">/</span>
          <span className="truncate text-[13px] font-medium text-fg">
            {doGrupo.find(c => c.id === canalAtivo)?.name ?? 'Nenhum canal'}
          </span>
        </nav>

        <button
          type="button"
          onClick={() => setBuscaAberta(true)}
          className="hidden h-8 w-56 shrink-0 items-center gap-2 rounded-md border
                     border-border-subtle bg-bg px-2.5 text-[13px] text-fg-muted
                     transition-colors hover:border-border hover:text-fg md:flex"
        >
          <Search aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
          <span className="flex-1 text-left">Buscar</span>
          <Kbd>Ctrl K</Kbd>
        </button>

        {/* Abaixo de md a caixa de busca vira so o icone: a barra inteira nao
            cabe em 320px sem empurrar o resto para fora da tela. */}
        <Dica texto="Buscar" atalho="Ctrl K" lado="bottom">
          <Botao
            variante="fantasma"
            tamanho="icone"
            onClick={() => setBuscaAberta(true)}
            className="md:hidden"
          >
            <Search aria-hidden="true" strokeWidth={1.75} />
            <span className="sr-only">Buscar</span>
          </Botao>
        </Dica>

        {!membrosFixos && (
          <Dica texto={membrosVisiveis ? 'Ocultar membros' : 'Mostrar membros'} lado="bottom">
            <Botao
              variante="fantasma"
              tamanho="icone"
              onClick={() => setMembrosVisiveis(a => !a)}
              aria-expanded={membrosVisiveis}
            >
              <Users aria-hidden="true" strokeWidth={1.75} />
              <span className="sr-only">
                {membrosVisiveis ? 'Ocultar membros' : 'Mostrar membros'}
              </span>
            </Botao>
          </Dica>
        )}

        {user && (
          <span className="flex shrink-0 items-center">
            <Avatar nome={user.displayName} url={user.avatarUrl} tamanho="md" />
            <span className="sr-only">Voce esta como {user.displayName}</span>
          </span>
        )}
      </header>

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
          // O botao que abre a gaveta mora na barra do topo; aqui fica so a
          // gaveta. Ela some da arvore ao fechar, e nao apenas dos olhos:
          // manter uma navegacao invisivel navegavel por teclado seria
          // esconder de quem enxerga e nao de quem tabula.
          gavetaCanais && (
            <nav
              aria-label="Canais do grupo"
              className="absolute inset-y-14 left-16 z-20 overflow-y-auto border-r
                         border-border bg-bg-raised
                         shadow-[8px_0_16px_-8px_rgb(0_0_0/0.30)]"
              style={{ width: 'var(--w-channels)' }}
            >
              <ListaCanais aoEscolher={() => setGavetaCanais(false)} />
            </nav>
          )
        )}

        <Conversa campoEscrita={campoEscrita} {...(aoDigitar === undefined ? {} : { aoDigitar })} />

        {/* Idem: quem mostra os membros e a barra do topo. */}
        {(membrosFixos || membrosVisiveis) && <PainelMembros />}
      </div>

      <BarraDeChamada />
      <BarraConexao latenciaMs={latenciaMs ?? null} />

      <PaletaDeComandos aberta={buscaAberta} aoFechar={() => setBuscaAberta(false)} />
    </div>
    </ProvedorDeDicas>
  )
}
