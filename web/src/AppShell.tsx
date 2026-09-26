import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useStore } from './lib/store.js'
import {
  CANAIS_MAX, CANAIS_MIN, CONVERSA_MIN, LAYOUT_PADRAO, MEMBROS_MAX, MEMBROS_MIN,
  guardarLayout, lerLayout, pctDe, pxDe,
} from './lib/layout.js'
import type { LayoutDoShell } from './lib/layout.js'
import { usaLarguraDe } from './lib/medida.js'
import { ManipuladorDePainel } from './ui/ManipuladorDePainel.js'
import {
  LARGURA_CANAIS_FIXOS, LARGURA_MEMBROS_FIXOS, usaLarguraMinima,
} from './lib/pontosDeQuebra.js'
import { BarraGrupos } from './features/groups/BarraGrupos.js'
import { ListaCanais } from './features/channels/ListaCanais.js'
import { Conversa } from './features/channels/Conversa.js'
import { PainelMembros } from './features/presence/PainelMembros.js'
import { BarraConexao } from './features/presence/BarraConexao.js'
import { BarraDeChamada } from './features/voice/BarraDeChamada.js'
import { PainelDoUsuario } from './features/settings/PainelDoUsuario.js'
import {
  registrarSaidaDaAba, registrarReanuncioDaChamada,
} from './features/voice/chamadaAtiva.js'
import { useAtalhosDaChamada } from './features/voice/atalhos.js'
import { ProvedorDeDicas, Dica } from './ui/Tooltip.js'
import { PanelLeftClose, PanelLeftOpen, Search, Users } from 'lucide-react'
import { PaletaDeComandos } from './features/busca/PaletaDeComandos.js'
import { FaixaDeVerificacao } from './features/auth/FaixaDeVerificacao.js'
import { FaixaDeInstalacao } from './features/voice/FaixaDeInstalacao.js'
import { BoasVindas } from './features/groups/BoasVindas.js'
import { Botao } from './ui/Botao.js'
import { Kbd } from './ui/Kbd.js'

/**
 * Quatro colunas: 64px fixos, e as outras tres negociaveis.
 *
 * As larguras de canais e membros deixaram de ser fixas: a pessoa arrasta a
 * divisoria e recolhe a coluna que nao quer, e a escolha e lembrada entre
 * visitas. So a barra de grupos continua imovel — ela nunca pode mudar de
 * largura quando aparece um nome longo.
 *
 * Abaixo de 900px a lista de canais sai da arvore e reaparece numa gaveta;
 * abaixo de 1200px o painel de membros faz o mesmo. Sair da arvore, e nao
 * apenas sumir por CSS, e o que impede o leitor de tela de anunciar uma
 * navegacao que ninguem consegue ver — e e a mesma razao de "recolhido"
 * significar "fora da arvore", e nao "largura zero".
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
  const groups = useStore(e => e.groups)
  const campoEscrita = useRef<HTMLTextAreaElement>(null)

  // O layout negociavel. Medido do container real: a biblioteca trabalha em
  // porcentagem, e o que a pessoa escolheu esta guardado em pixels.
  const areaDosPaineis = useRef<HTMLDivElement>(null)
  const largura = usaLarguraDe(areaDosPaineis)
  const [layout, setLayout] = useState<LayoutDoShell>(lerLayout)
  const refCanais = useRef<ImperativePanelHandle>(null)
  const refMembros = useRef<ImperativePanelHandle>(null)

  /**
   * A conversa fica com o que sobra.
   *
   * Sem `defaultSize` a biblioteca avisa no console e distribui o resto por
   * conta propria no primeiro quadro — que e justamente o salto de largura que
   * os paineis existem para evitar. Declarar o complemento faz a soma dos
   * `defaultSize` fechar em 100 desde o primeiro render.
   */
  const conversaPct = 100
    - (canaisFixos ? pctDe(layout.canaisPx, largura) : 0)
    - (membrosFixos ? pctDe(layout.membrosPx, largura) : 0)

  const guardar = useCallback((mudanca: Partial<LayoutDoShell>) => {
    setLayout(atual => {
      const novo = { ...atual, ...mudanca }
      guardarLayout(novo)
      return novo
    })
  }, [])

  /**
   * Um controle, dois mecanismos.
   *
   * Abaixo do ponto de quebra a coluna e uma gaveta sobreposta; acima, um
   * painel que recolhe. O botao do cabecalho e o mesmo nos dois casos — quem
   * usa nao precisa saber que existem dois mecanismos, e e por isso que ele
   * deixou de aparecer so em tela estreita.
   *
   * Quem manda no "recolhido" e ESTE estado, e nao o painel. Duas razoes, e a
   * segunda e a que importa: a primeira e que o conteudo precisa sair da
   * arvore, o que so este lado sabe fazer; a segunda e que delegar a verdade a
   * biblioteca tornaria o comportamento dependente de medidas de layout reais
   * — indeterminavel em teste, e fragil em qualquer container que ainda nao
   * mediu. O painel e mantido em dia por um efeito, logo abaixo.
   */
  const alternarCanais = useCallback(() => {
    if (!canaisFixos) return setGavetaCanais(a => !a)
    setLayout(atual => {
      const novo = { ...atual, canaisRecolhido: !atual.canaisRecolhido }
      guardarLayout(novo)
      return novo
    })
  }, [canaisFixos])

  const alternarMembros = useCallback(() => {
    if (!membrosFixos) return setMembrosVisiveis(a => !a)
    setLayout(atual => {
      const novo = { ...atual, membrosRecolhido: !atual.membrosRecolhido }
      guardarLayout(novo)
      return novo
    })
  }, [membrosFixos])

  /**
   * O painel segue o estado. Arrastar ate o fim tambem recolhe, e nesse caso o
   * caminho e o inverso — `onCollapse` avisa este estado —, entao os dois
   * sentidos existem e a checagem de `isCollapsed` evita o vai-e-vem.
   *
   * Dentro de `try`: a biblioteca lanca "Panel size not found" enquanto o
   * grupo ainda nao mediu o container, e isso acontece de verdade — no
   * primeiro quadro, e em qualquer ambiente sem motor de layout. Sincronizar o
   * painel e um AGRADO visual; a verdade ja esta no estado, e o conteudo ja
   * saiu da arvore. Deixar a excecao subir derrubaria a aplicacao inteira por
   * causa de uma animacao de largura.
   */
  const sincronizar = (
    painel: ImperativePanelHandle | null, recolhido: boolean,
  ): void => {
    if (painel === null) return
    try {
      if (recolhido && !painel.isCollapsed()) painel.collapse()
      if (!recolhido && painel.isCollapsed()) painel.expand()
    } catch {
      // Ainda sem medida. O proximo quadro tenta de novo.
    }
  }

  useEffect(() => {
    sincronizar(refCanais.current, layout.canaisRecolhido)
  }, [layout.canaisRecolhido, canaisFixos])

  useEffect(() => {
    sincronizar(refMembros.current, layout.membrosRecolhido)
  }, [layout.membrosRecolhido, membrosFixos])

  const canaisAbertos = canaisFixos ? !layout.canaisRecolhido : gavetaCanais
  const membrosAbertos = membrosFixos ? !layout.membrosRecolhido : membrosVisiveis

  const doGrupo = channels.filter(c => c.groupId === grupoAtivo)

  /**
   * Os controles do cabecalho do canal, montados aqui e emprestados a
   * `Conversa`.
   *
   * Moram no shell porque o ESTADO mora no shell: recolher a coluna de canais
   * e mostrar os membros mudam o layout inteiro, nao a conversa. A conversa so
   * empresta o espaco — e e o espaco certo, porque e onde a pessoa esta
   * olhando quando decide abrir ou fechar uma coluna.
   *
   * `aria-expanded` e `aria-controls` seguem junto: e a alternativa ao arrasto
   * que a WCAG 2.5.7 exige, e quem nao arrasta a divisoria continua recolhendo
   * e reabrindo a coluna daqui.
   */
  const aberturaDeCanais = (
    <Dica texto={canaisAbertos ? 'Fechar canais' : 'Abrir canais'} lado="bottom">
      <Botao
        variante="fantasma"
        tamanho="iconeSm"
        onClick={alternarCanais}
        aria-expanded={canaisAbertos}
        aria-controls="canais"
      >
        {canaisAbertos
          ? <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
          : <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />}
        <span className="sr-only">{canaisAbertos ? 'Fechar canais' : 'Abrir canais'}</span>
      </Botao>
    </Dica>
  )

  /**
   * A chamada em curso e a identidade, que andam juntas.
   *
   * Uma so instancia, em dois lugares possiveis. No rodape da coluna de canais
   * quando ela existe e esta aberta; no rodape da JANELA quando nao. A
   * alternativa — deixa-las so na coluna — apagaria o estado do microfone
   * exatamente para quem recolheu a coluna ou esta numa janela estreita, e
   * esta barra existe justamente para que ninguem fique com o microfone aberto
   * sem saber. Escondida, ela seria pior do que inexistente.
   */
  const rodapeDePresenca = (
    <>
      <BarraDeChamada />
      <PainelDoUsuario />
    </>
  )
  const rodapeNaColuna = canaisFixos && canaisAbertos

  const acoesDoCanal = (
    <>
      <button
        type="button"
        onClick={() => setBuscaAberta(true)}
        className="hidden h-8 w-48 shrink-0 items-center gap-2 rounded-md border
                   border-border-subtle bg-bg px-2.5 text-[13px] text-fg-muted
                   transition-colors hover:border-border hover:text-fg lg:flex"
      >
        <Search aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
        <span className="flex-1 text-left">Buscar</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      {/* Abaixo de lg a caixa de busca vira so o icone: a barra inteira nao
          cabe em 320px sem empurrar o resto para fora da tela. */}
      <Dica texto="Buscar" atalho="Ctrl K" lado="bottom">
        <Botao
          variante="fantasma"
          tamanho="iconeSm"
          onClick={() => setBuscaAberta(true)}
          className="lg:hidden"
        >
          <Search aria-hidden="true" strokeWidth={1.75} />
          <span className="sr-only">Buscar</span>
        </Botao>
      </Dica>

      <Dica texto={membrosAbertos ? 'Ocultar membros' : 'Mostrar membros'} lado="bottom">
        <Botao
          variante="fantasma"
          tamanho="iconeSm"
          onClick={alternarMembros}
          aria-expanded={membrosAbertos}
          aria-controls="membros"
        >
          <Users aria-hidden="true" strokeWidth={1.75} />
          <span className="sr-only">
            {membrosAbertos ? 'Ocultar membros' : 'Mostrar membros'}
          </span>
        </Botao>
      </Dica>
    </>
  )

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
  // O par do de cima: um cuida de quem fecha a aba, o outro de quem volta.
  useEffect(registrarReanuncioDaChamada, [])

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
        <div className="relative flex h-full flex-col overflow-hidden">
          <FaixaDeInstalacao />
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
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Primeiro elemento focavel da aplicacao. */}
      <a href="#conversa" className="pular-para-conversa">Pular para a conversa</a>

      <FaixaDeInstalacao />
      <FaixaDeVerificacao />

      <div ref={areaDosPaineis} className="relative flex min-h-0 flex-1 overflow-hidden">
        {/*
          A barra de grupos fica FORA do grupo de paineis, e isso nao e
          arrumacao. A biblioteca dimensiona em porcentagem; 64px viraria um
          `minSize` recalculado a cada resize da janela — uma largura fixa
          expressa como porcentagem movel, que e exatamente a "barra lateral
          que pula" que o proprio componente existe para impedir. Alem disso,
          ela nunca e redimensionavel nem recolhivel, entao nao ha nada a
          ganhar colocando-a la dentro.
        */}
        <BarraGrupos />

        {/*
          Cada painel leva `flex min-h-0 flex-col`, e isso nao e enfeite.

          A biblioteca cria o `Panel` com `flexBasis/flexGrow/flexShrink` e
          `overflow: hidden`, e NUNCA declara `display`. Ou seja: o painel e um
          bloco. Um filho direto com `flex-1` nao e item flex de ninguem, o
          `flex-1` morre em silencio, e a altura do filho vira `auto` — ele
          cresce ate o conteudo, o `overflow-y-auto` dele nunca gera barra
          (porque `scrollHeight === clientHeight`), o `mt-auto` de uma barra de
          acoes resolve para zero, e o excedente e recortado pelo painel. Foi
          exatamente assim que os botoes de sair da chamada sumiram.

          Declarar o `display` aqui, e nao espalhar `h-full` nos filhos, e o que
          protege tambem o proximo componente que alguem puser dentro.
        */}
        <PanelGroup direction="horizontal" className="min-w-0 flex-1">
          {canaisFixos && (
            <>
              <Panel
                id="canais"
                order={1}
                ref={refCanais}
                collapsible
                collapsedSize={0}
                defaultSize={pctDe(layout.canaisPx, largura)}
                minSize={pctDe(CANAIS_MIN, largura)}
                maxSize={pctDe(CANAIS_MAX, largura)}
                onCollapse={() => guardar({ canaisRecolhido: true })}
                onExpand={() => guardar({ canaisRecolhido: false })}
                onResize={pct => guardar({ canaisPx: pxDe(pct, largura) })}
                className="flex min-h-0 flex-col border-r border-border-subtle bg-bg-raised"
              >
                {/*
                  Recolhido NAO e "largura zero": o conteudo sai da arvore. Um
                  `<nav>` de 0px continua tabulavel e continua sendo anunciado
                  pelo leitor de tela — esconder de quem enxerga e nao de quem
                  tabula e o defeito que `pontosDeQuebra.ts` existe para
                  impedir. A casca do Panel fica porque a biblioteca precisa
                  dela para calcular o grupo.
                */}
                {!layout.canaisRecolhido && (
                  <>
                    <nav
                      aria-label="Canais do grupo"
                      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
                    >
                      <ListaCanais />
                    </nav>
                    {/*
                      A chamada e a identidade no RODAPE desta coluna, e nao
                      numa faixa que atravessa a janela.

                      Elas pertencem a mesma pergunta que a coluna inteira
                      responde — "onde eu estou e com quem" —, e uma faixa
                      largura-total no pe da tela pagava esse contexto com uma
                      linha inteira de altura roubada da conversa. Aqui a
                      chamada fica a um palmo do canal de voz que a originou.
                    */}
                    {rodapeNaColuna ? rodapeDePresenca : null}
                  </>
                )}
              </Panel>
              <ManipuladorDePainel
                rotulo="Redimensionar a lista de canais"
                porcentagem={layout.canaisRecolhido ? 0 : pctDe(layout.canaisPx, largura)}
                aoRestaurar={() => {
                  refCanais.current?.resize(pctDe(LAYOUT_PADRAO.canaisPx, largura))
                }}
              />
            </>
          )}

          {/*
            `conversa` sem prefixo colidia com o id da secao la dentro: a
            biblioteca escreve o id do painel no DOM, e o link "pular para a
            conversa" acabava aterrissando na casca do painel em vez de na
            regiao de conversa.
          */}
          <Panel
            id="painel-conversa"
            order={2}
            defaultSize={conversaPct}
            minSize={pctDe(CONVERSA_MIN, largura)}
            className="flex min-h-0 flex-col"
          >
            <Conversa
              campoEscrita={campoEscrita}
              {...(aoDigitar === undefined ? {} : { aoDigitar })}
              antes={aberturaDeCanais}
              depois={acoesDoCanal}
            />
          </Panel>

          {membrosFixos && (
            <>
              <ManipuladorDePainel
                rotulo="Redimensionar o painel de membros"
                porcentagem={layout.membrosRecolhido ? 0 : pctDe(layout.membrosPx, largura)}
                aoRestaurar={() => {
                  refMembros.current?.resize(pctDe(LAYOUT_PADRAO.membrosPx, largura))
                }}
              />
              <Panel
                id="membros"
                order={3}
                ref={refMembros}
                collapsible
                collapsedSize={0}
                defaultSize={pctDe(layout.membrosPx, largura)}
                minSize={pctDe(MEMBROS_MIN, largura)}
                maxSize={pctDe(MEMBROS_MAX, largura)}
                onCollapse={() => guardar({ membrosRecolhido: true })}
                onExpand={() => guardar({ membrosRecolhido: false })}
                onResize={pct => guardar({ membrosPx: pxDe(pct, largura) })}
                className="flex min-h-0 flex-col"
              >
                {!layout.membrosRecolhido && <PainelMembros />}
              </Panel>
            </>
          )}
        </PanelGroup>

        {/*
          Em tela estreita as colunas saem do grupo e voltam a ser
          sobreposicao, exatamente como antes. Redimensionar uma gaveta que
          cobre a conversa inteira nao faria sentido nenhum.
        */}
        {!canaisFixos && gavetaCanais && (
          <nav
            aria-label="Canais do grupo"
            className="absolute inset-y-0 left-16 z-20 overflow-y-auto border-r
                       border-border bg-bg-raised
                       shadow-[8px_0_16px_-8px_rgb(0_0_0/0.30)]"
            style={{ width: 'var(--w-channels)' }}
          >
            <ListaCanais aoEscolher={() => setGavetaCanais(false)} />
          </nav>
        )}

        {!membrosFixos && membrosVisiveis && <PainelMembros sobreposicao />}
      </div>

      {/*
        Quando a coluna de canais nao esta na tela, a chamada e a identidade
        voltam para o rodape da janela. E o mesmo par de componentes, nunca
        montado duas vezes.
      */}
      {rodapeNaColuna ? null : rodapeDePresenca}
      <BarraConexao latenciaMs={latenciaMs ?? null} />

      <PaletaDeComandos aberta={buscaAberta} aoFechar={() => setBuscaAberta(false)} />
    </div>
    </ProvedorDeDicas>
  )
}
