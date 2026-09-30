import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { corDoMembro, useStore } from '../../lib/store.js'
import { cn } from '../../lib/utils.js'
import { Avatar } from '../../ui/Avatar.js'
import { usePerfilAberto } from '../presence/perfilAberto.js'
import { AcoesDaMensagem } from './AcoesDaMensagem.js'
import { useRealce } from '../../lib/rotaDoCanal.js'
import { Anexos } from './Anexos.js'
import { Reacoes } from './Reacoes.js'
import { reenviarMensagem } from './envio.js'
import { carregarAnteriores as buscarAnteriores, carregarHistorico, useHistorico } from './historico.js'
import type { Mensagem } from '../../lib/tipos.js'

/**
 * Referencia estavel para canal sem historico. Devolver `[]` novo dentro do
 * seletor faria o zustand ver estado diferente a cada renderizacao, e o
 * componente entraria em laco infinito de atualizacao.
 */
const VAZIO: Mensagem[] = []

/** Mensagens do mesmo autor dentro desta janela compartilham o cabecalho. */
const JANELA_DE_AGRUPAMENTO_MS = 5 * 60 * 1000

/** A partir daqui a pessoa esta lendo o historico, e nao acompanhando o fim. */
const TOLERANCIA_DE_FIM_PX = 40

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const DIA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

function mesmoDia(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/**
 * A lista da conversa.
 *
 * Regiao viva `polite` com `aria-relevant="additions"`: reler tudo a cada
 * mensagem seria o comportamento que torna chat insuportavel no leitor de tela.
 * E quando o campo de escrita tem foco, o anuncio para por completo - quem esta
 * digitando nao pode ser interrompido pela propria conversa.
 */
export function MessageList({ escrevendo, digitando, carregarAnteriores, aoResponder }: {
  escrevendo: boolean
  digitando?: string[]
  carregarAnteriores?: (antesDe: string) => void
  /** Preenche o composer com a citacao. Ausente onde nao ha composer. */
  aoResponder?: (mensagem: Mensagem) => void
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const porCanal = useStore(e => e.mensagens)
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user?.id ?? null)
  const marcarLido = useStore(e => e.marcarLido)

  /**
   * O marco de leitura CONGELADO na abertura do canal.
   *
   * Ele nao pode acompanhar a leitura em tempo real: se acompanhasse, o
   * separador "novas mensagens" saltaria para baixo a cada mensagem que
   * chegasse e a pessoa nunca conseguiria ver onde tinha parado. Ele so se
   * move quando o canal e trocado — que e quando a pergunta "onde eu parei?"
   * volta a ser feita.
   */
  const leituras = useStore(e => e.leituras)
  const marcoDeAbertura = useRef<string | null>(null)
  const canalDoMarco = useRef<string | null>(null)
  if (canalDoMarco.current !== canalAtivo) {
    canalDoMarco.current = canalAtivo
    marcoDeAbertura.current = canalAtivo === null ? null : leituras[canalAtivo] ?? null
  }

  const mensagens = canalAtivo === null ? VAZIO : porCanal[canalAtivo] ?? VAZIO

  const caixa = useRef<HTMLDivElement>(null)
  const [noFim, setNoFim] = useState(true)
  const [novasAcima, setNovasAcima] = useState(false)
  const historico = useHistorico(e => canalAtivo === null ? undefined : e.porCanal[canalAtivo])
  /** A primeira e a ultima mensagem vistas no render anterior. */
  const pontas = useRef({ primeira: mensagens[0]?.id, ultima: mensagens.at(-1)?.id })
  /**
   * Distancia ate o FUNDO da caixa medida antes de pedir a pagina anterior.
   *
   * E ela que segura a leitura no lugar: sem isto, cinquenta mensagens
   * inseridas acima empurravam o conteudo para baixo e a pessoa, que estava
   * lendo a mensagem do topo, pulava para uma de meia hora antes.
   */
  const ancora = useRef<number | null>(null)

  const nomeDe = (autorId: string | null): string =>
    autorId === null
      ? 'usuário removido'
      : members.find(m => m.userId === autorId)?.displayName ?? 'usuário removido'

  const grupoDoCanal = useStore(e => e.channels.find(c => c.id === e.canalAtivo)?.groupId ?? null)
  const cargos = useStore(e => e.cargos)
  const cargosDoMembro = useStore(e => e.cargosDoMembro)
  const abrirPerfil = usePerfilAberto(e => e.abrirPerfil)
  /** A mensagem com as acoes reveladas pelo toque. */
  const [ativa, setAtiva] = useState<string | null>(null)

  /** Nome, avatar e cor de cargo de quem escreveu, no grupo deste canal. */
  const pessoaDe = (autorId: string | null): { nome: string; avatarUrl: string | null; cor: string | null } => {
    if (autorId === null) return { nome: 'usuário removido', avatarUrl: null, cor: null }
    const membro = members.find(m => m.userId === autorId && m.groupId === grupoDoCanal)
      ?? members.find(m => m.userId === autorId)
    return {
      nome: membro?.displayName ?? 'usuário removido',
      avatarUrl: membro?.avatarUrl ?? null,
      cor: grupoDoCanal === null ? null : corDoMembro({ cargos, cargosDoMembro }, grupoDoCanal, autorId),
    }
  }

  /**
   * Marcar como lido enquanto a pessoa esta olhando o fim da conversa.
   *
   * A condicao `noFim` e o ponto: marcar sempre que uma mensagem chega faria o
   * contador zerar para quem esta lendo o historico no meio do canal — ou seja,
   * exatamente para quem MAIS depende dele.
   */
  useEffect(() => {
    const ultima = mensagens.at(-1)
    if (canalAtivo === null || ultima === undefined || !noFim) return
    if (ultima.envio !== undefined) return
    if (leituras[canalAtivo] === ultima.id) return
    marcarLido(canalAtivo, ultima.id)
    // Engolir a falha aqui e deliberado, e nao descuido: o marco de leitura e
    // idempotente e monotonico, entao a proxima mensagem que chegar com a
    // conversa no fim reenvia o marco mais novo e cura sozinha o que se perdeu.
    // O `catch` precisa existir mesmo assim — um `void` sobre promessa que
    // rejeita vira rejeicao nao tratada no console de quem usa.
    api.put(`/channels/${canalAtivo}/read`, { lastReadMessageId: ultima.id })
      .catch(() => undefined)
  }, [canalAtivo, mensagens, noFim, leituras, marcarLido])

  function medirRolagem(): void {
    const el = caixa.current
    if (el === null) return
    const distanciaDoFim = el.scrollHeight - el.clientHeight - el.scrollTop
    const chegouAoFim = distanciaDoFim <= TOLERANCIA_DE_FIM_PX
    setNoFim(chegouAoFim)
    if (chegouAoFim) setNovasAcima(false)

    // Perto do topo: pedir o trecho anterior antes que a pessoa encoste na
    // borda mantem a leitura continua em vez de travar e depois pular.
    if (el.scrollTop <= TOLERANCIA_DE_FIM_PX && mensagens.length > 0) {
      if (carregarAnteriores !== undefined) {
        carregarAnteriores(mensagens[0]!.id)
        return
      }
      if (canalAtivo === null || historico?.anteriores === 'carregando' || historico?.inicio) return
      ancora.current = el.scrollHeight - el.scrollTop
      void buscarAnteriores(canalAtivo).then(chegaram => {
        if (chegaram === 0) ancora.current = null
      })
    }
  }

  /**
   * Ancora de rolagem: cola no fim para quem ja estava no fim, e apenas avisa
   * quem estava mais acima. Arrastar a leitura de quem revisa o historico e a
   * forma mais rapida de fazer alguem perder o lugar.
   *
   * "Nova" e quem chegou no FIM da lista. Comparar o tamanho, como antes,
   * tratava a pagina antiga inserida no topo como cinquenta mensagens novas —
   * e acendia o aviso "Novas mensagens" para quem so tinha rolado para cima.
   */
  useLayoutEffect(() => {
    const el = caixa.current
    const antes = pontas.current
    const agora = { primeira: mensagens[0]?.id, ultima: mensagens.at(-1)?.id }
    pontas.current = agora
    if (el === null) return

    if (agora.primeira !== antes.primeira && ancora.current !== null) {
      el.scrollTop = el.scrollHeight - ancora.current
      ancora.current = null
    }

    /**
     * A primeira vez que o canal ganha mensagens, a leitura comeca no PRIMEIRO
     * NAO LIDO, e nao no fim (Etapa 2.8). Quem volta a um canal com trinta
     * mensagens novas quer comecar pela primeira delas; cair no fim obrigava a
     * rolar para cima procurando o separador.
     */
    if (antes.primeira === undefined && agora.primeira !== undefined) {
      if (irParaPrimeiraNaoLida()) return
    }

    const chegouNoFim = agora.ultima !== undefined && agora.ultima !== antes.ultima
      && (antes.ultima === undefined || agora.ultima > antes.ultima)
    if (!chegouNoFim) return
    if (noFim) el.scrollTop = el.scrollHeight
    else setNovasAcima(true)
  }, [mensagens, noFim])

  /** Rola ate o separador "Novas mensagens", se houver. Devolve se rolou. */
  function irParaPrimeiraNaoLida(): boolean {
    const el = caixa.current
    const separador = el?.querySelector<HTMLElement>('[data-primeira-nova]')
    if (el === null || el === undefined || separador === null || separador === undefined) return false
    separador.scrollIntoView?.({ block: 'start' })
    // Mede de verdade: se tudo cabe na tela, a pessoa ja esta "no fim", e a
    // leitura tem de ser marcada — sem isto, um canal curto nunca zeraria.
    medirRolagem()
    return true
  }

  // Trocar de canal recomeca no primeiro nao lido — ou no fim, se nao ha.
  useEffect(() => {
    setNovasAcima(false)
    if (irParaPrimeiraNaoLida()) return
    setNoFim(true)
    const el = caixa.current
    if (el !== null) el.scrollTop = el.scrollHeight
    // So na troca de canal: `irParaPrimeiraNaoLida` le o DOM do momento.
  }, [canalAtivo])

  /**
   * A mensagem que um link pediu (Etapa 2.1).
   *
   * Se ela ainda nao esta carregada, busca paginas mais antigas ate acha-la —
   * com um teto, para que um link para o comeco de um canal de dez anos nao
   * vire duzentas requisicoes. Achada, rola ate ela e a realca por 2 s.
   */
  const realce = useRealce()
  const [realcada, setRealcada] = useState<string | null>(null)
  const tentativasDoRealce = useRef(0)
  useEffect(() => {
    if (realce.channelId !== canalAtivo || realce.messageId === null || canalAtivo === null) return
    const alvo = document.getElementById(`mensagem-${realce.messageId}`)
    if (alvo !== null) {
      alvo.scrollIntoView?.({ block: 'center' })
      setRealcada(realce.messageId)
      realce.concluir()
      tentativasDoRealce.current = 0
      const t = setTimeout(() => { setRealcada(null) }, 2000)
      return () => { clearTimeout(t) }
    }
    if (historico?.inicio === true || tentativasDoRealce.current >= 20) {
      realce.concluir()
      tentativasDoRealce.current = 0
      return
    }
    if (historico?.primeira !== 'pronto' || historico.anteriores === 'carregando') return
    tentativasDoRealce.current += 1
    void buscarAnteriores(canalAtivo)
  }, [realce, canalAtivo, mensagens, historico])

  function irParaOFim(): void {
    const el = caixa.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    setNoFim(true)
    setNovasAcima(false)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={caixa}
        onScroll={medirRolagem}
        role="log"
        aria-label="Mensagens"
        aria-live={escrevendo ? 'off' : 'polite'}
        aria-relevant="additions"
        // Sem `gap` uniforme: o ritmo vem da propria mensagem (Design System
        // v2). Linhas do mesmo autor ficam coladas; um autor novo abre espaco.
        // Com o `gap` de antes, a segunda linha de uma pessoa ficava tao longe
        // da primeira quanto a fala de outra pessoa.
        className="flex flex-1 flex-col overflow-y-auto"
        style={{ padding: 'var(--space-gutter)' }}
      >
        {historico?.anteriores === 'carregando' && (
          <p role="status" className="py-2 text-center text-xs text-fg-muted">
            Carregando mensagens anteriores…
          </p>
        )}
        {historico?.anteriores === 'falhou' && canalAtivo !== null && (
          <p className="flex items-center justify-center gap-2 py-2 text-xs text-fg-muted">
            Não foi possível carregar as mensagens anteriores.
            <button
              type="button"
              onClick={() => { void buscarAnteriores(canalAtivo) }}
              className="font-medium text-accent underline underline-offset-2"
            >
              Tentar de novo
            </button>
          </p>
        )}
        {historico?.inicio === true && mensagens.length > 0 && (
          <p className="py-2 text-center text-xs text-fg-muted">Início da conversa</p>
        )}

        {/*
          Vazio so e vazio quando o servidor disse que e. Antes a lista
          afirmava "Nenhuma mensagem ainda" enquanto a primeira pagina ainda
          estava a caminho — e continuava afirmando se a busca falhasse.
        */}
        {mensagens.length === 0 && historico?.primeira === 'carregando' && (
          <p role="status" aria-busy="true" className="text-sm text-fg-muted">
            Carregando mensagens…
          </p>
        )}
        {mensagens.length === 0 && historico?.primeira === 'falhou' && canalAtivo !== null && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-fg">Não foi possível carregar as mensagens deste canal.</p>
            <button
              type="button"
              onClick={() => { carregarHistorico(canalAtivo) }}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium
                         text-fg hover:bg-bg-hover"
            >
              Tentar de novo
            </button>
          </div>
        )}
        {mensagens.length === 0 && (historico === undefined || historico.primeira === 'pronto') && (
          <p className="text-sm text-fg-muted">
            Nenhuma mensagem ainda. Escreva a primeira no campo abaixo.
          </p>
        )}

        {mensagens.map((mensagem, indice) => {
          const anterior = mensagens[indice - 1]
          const trocouDeDia = anterior === undefined
            || !mesmoDia(anterior.createdAt, mensagem.createdAt)
          const agrupada = !trocouDeDia
            && anterior !== undefined
            && anterior.authorId === mensagem.authorId
            && new Date(mensagem.createdAt).getTime()
              - new Date(anterior.createdAt).getTime() < JANELA_DE_AGRUPAMENTO_MS

          const citada = mensagem.replyToId === null || mensagem.replyToId === undefined
            ? undefined
            : mensagens.find(m => m.id === mensagem.replyToId)
          // A primeira mensagem depois do marco de abertura. `>` e nao `>=`
          // porque o marco E a ultima lida: ela fica ACIMA do separador.
          const primeiraNova = marcoDeAbertura.current !== null
            && mensagem.id > marcoDeAbertura.current
            && (anterior === undefined || anterior.id <= marcoDeAbertura.current)

          const autor = pessoaDe(mensagem.authorId)
          const meMenciona = eu !== null && mensagem.authorId !== eu
            && (mensagem.mentionsEveryone === true || (mensagem.mentions ?? []).includes(eu))
          const confirmada = mensagem.envio === undefined

          return (
            <div key={mensagem.id} className="flex flex-col">
              {primeiraNova && (
                <div
                  role="separator"
                  aria-label="Novas mensagens"
                  data-primeira-nova=""
                  className="my-2 flex scroll-mt-4 items-center gap-2 text-xs font-semibold text-accent"
                >
                  <span className="h-px flex-1 bg-accent" />
                  Novas mensagens
                  <span className="h-px flex-1 bg-accent" />
                </div>
              )}
              {trocouDeDia && (
                <div
                  role="separator"
                  className="my-3 flex items-center gap-2 text-xs font-medium text-fg-muted"
                >
                  <span className="h-px flex-1 bg-border-subtle" />
                  {DIA.format(new Date(mensagem.createdAt))}
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
              )}

              {/*
                Mensagem v2: avatar na primeira linha do bloco, hora no hover
                das seguintes, acoes numa barra flutuante.

                A mensagem que me menciona ganha o fundo `accentSubtle` e a
                faixa lateral do acento — e a unica linha da conversa que e
                COMIGO, e ela tem de se achar de relance num canal de cem.
              */}
              <article
                id={`mensagem-${mensagem.id}`}
                data-realcada={realcada === mensagem.id ? '' : undefined}
                aria-busy={mensagem.envio === 'enviando' ? 'true' : undefined}
                aria-label={meMenciona ? `Menciona você: ${autor.nome}` : undefined}
                onPointerUp={evento => {
                  // No toque nao ha hover: tocar na mensagem revela as acoes.
                  if (evento.pointerType === 'touch') setAtiva(mensagem.id)
                }}
                className={cn(
                  `group/mensagem relative -mx-2 flex gap-3 rounded-md border-l-2 px-2
                   hover:bg-bg-hover/40 focus-within:bg-bg-hover/40`,
                  agrupada ? 'py-px' : 'mt-3 pb-0.5 pt-1 first:mt-0',
                  meMenciona ? 'border-accent bg-accent-subtle hover:bg-accent-subtle' : 'border-transparent',
                  // A mensagem aberta por link acende e apaga devagar: o olho
                  // encontra onde pousou, e o realce nao fica pendurado.
                  realcada === mensagem.id && 'bg-accent-subtle transition-colors duration-700',
                  mensagem.envio === 'enviando' && 'opacity-60',
                )}
              >
                <div className="w-8 shrink-0">
                  {agrupada ? (
                    <time
                      dateTime={mensagem.createdAt}
                      aria-hidden="true"
                      className="numerico -ml-1 block whitespace-nowrap pt-0.5 text-right font-mono
                                 text-xs leading-5 tracking-tight text-fg-muted opacity-0 group-hover/mensagem:opacity-100
                                 group-focus-within/mensagem:opacity-100"
                    >
                      {HORA.format(new Date(mensagem.createdAt))}
                    </time>
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={() => { if (mensagem.authorId !== null) abrirPerfil(mensagem.authorId) }}
                      className="mt-0.5 block rounded-full"
                    >
                      <Avatar nome={autor.nome} url={autor.avatarUrl} tamanho="md" />
                    </button>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {/*
                    A citacao vem ANTES do cabecalho porque e ela que da o
                    contexto. O texto inteiro vai para o elemento e o corte e do
                    CSS, com reticencias: cortar a string em 80 caracteres
                    deixava a frase terminar no meio de uma palavra, sem aviso.

                    `replyToId` presente com a citada ausente e o caso normal de
                    mensagem apagada — o `SET NULL` do banco preserva a resposta
                    de proposito, e a linha diz isso em vez de sumir.
                  */}
                  {(mensagem.replyToId !== null && mensagem.replyToId !== undefined) && (
                    <p className="mb-0.5 max-w-[72ch] truncate border-l-2 border-border pl-2 text-xs text-fg-muted">
                      {citada === undefined
                        ? 'Em resposta a uma mensagem apagada'
                        : `Em resposta a ${nomeDe(citada.authorId)}: ${citada.content}`}
                    </p>
                  )}
                  {!agrupada && (
                    <p className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => { if (mensagem.authorId !== null) abrirPerfil(mensagem.authorId) }}
                        className="cor-de-cargo text-sm font-semibold text-fg hover:underline"
                        style={autor.cor === null ? undefined : { '--cor-cargo': autor.cor } as CSSProperties}
                      >
                        {autor.nome}
                      </button>
                      <time
                        dateTime={mensagem.createdAt}
                        className="numerico font-mono text-xs text-fg-muted"
                      >
                        {HORA.format(new Date(mensagem.createdAt))}
                      </time>
                    </p>
                  )}
                  {/*
                    Foto sem legenda e mensagem legitima, e o servidor a aceita.
                    Um paragrafo vazio abriria um buraco de linha entre o nome e
                    a imagem, entao ele so existe quando ha texto.

                    72 caracteres de largura, e nao a coluna inteira: numa janela
                    de 1440px a linha passava de 110, e o olho perde a volta.
                  */}
                  {mensagem.content !== '' && (
                    <p className="max-w-[72ch] whitespace-pre-wrap break-words text-corpo text-fg">
                      {mensagem.content}
                      {mensagem.editedAt !== null && (
                        <span className="ml-1 text-xs text-fg-muted">(editada)</span>
                      )}
                    </p>
                  )}
                  <Anexos anexos={mensagem.attachments ?? []} />

                  {confirmada && (
                    <Reacoes
                      messageId={mensagem.id}
                      reacoes={mensagem.reactions ?? []}
                      eu={eu}
                    />
                  )}
                  {mensagem.envio === 'falhou' && (
                    <p className="flex items-center gap-2 text-xs text-danger">
                      Não foi enviada.
                      {/*
                        O reenvio leva o mesmo ID: se a primeira tentativa
                        chegou e so a resposta se perdeu, o servidor recusa a
                        duplicata em vez de aceitar duas vezes a mesma fala.
                      */}
                      <button
                        type="button"
                        onClick={() => void reenviarMensagem(mensagem)}
                        className="font-medium underline underline-offset-2"
                      >
                        Tentar de novo
                      </button>
                    </p>
                  )}
                </div>

                {/*
                  Reagir e responder so existem para mensagem JA CONFIRMADA: um
                  eco otimista ainda nao tem id no servidor, e reagir a ele
                  bateria num 404.
                */}
                {confirmada && (
                  <AcoesDaMensagem
                    mensagem={mensagem}
                    eu={eu}
                    visivel={ativa === mensagem.id}
                    {...(aoResponder === undefined ? {} : { aoResponder })}
                  />
                )}
              </article>
            </div>
          )
        })}
      </div>

      {novasAcima && (
        <button
          type="button"
          onClick={irParaOFim}
          className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded border border-border
                     bg-bg-raised px-3 py-1 text-xs text-fg shadow-popover"
        >
          Novas mensagens
        </button>
      )}

      {/*
        Fora da regiao viva de proposito: digitacao e informacao de baixo valor
        e altissima frequencia, e anuncia-la seria ruido puro.
      */}
      {digitando !== undefined && digitando.length > 0 && (
        <p className="px-4 pb-1 text-xs text-fg-muted">
          {digitando.join(', ')} {digitando.length === 1 ? 'está digitando' : 'estão digitando'}...
        </p>
      )}
    </div>
  )
}
