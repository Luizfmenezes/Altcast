import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Anexos } from './Anexos.js'
import { Reacoes } from './Reacoes.js'
import { enviarMensagem } from './envio.js'
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
  const quantidadeAnterior = useRef(mensagens.length)

  const nomeDe = (autorId: string | null): string =>
    autorId === null
      ? 'usuario removido'
      : members.find(m => m.userId === autorId)?.displayName ?? 'usuario removido'

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

    // Topo da caixa: pedir o trecho anterior antes que a pessoa encoste na
    // borda mantem a leitura continua em vez de travar e depois pular.
    if (el.scrollTop <= 0 && mensagens.length > 0) carregarAnteriores?.(mensagens[0]!.id)
  }

  /**
   * Ancora de rolagem: cola no fim para quem ja estava no fim, e apenas avisa
   * quem estava mais acima. Arrastar a leitura de quem revisa o historico e a
   * forma mais rapida de fazer alguem perder o lugar.
   */
  useLayoutEffect(() => {
    const el = caixa.current
    if (el === null) return
    const cresceu = mensagens.length > quantidadeAnterior.current
    quantidadeAnterior.current = mensagens.length
    if (!cresceu) return
    if (noFim) el.scrollTop = el.scrollHeight
    else setNovasAcima(true)
  }, [mensagens.length, noFim])

  // Trocar de canal recomeca no fim: chegar num canal no meio do historico
  // antigo nao e o que ninguem espera.
  useEffect(() => {
    setNoFim(true)
    setNovasAcima(false)
    const el = caixa.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [canalAtivo])

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
        className="flex flex-1 flex-col overflow-y-auto"
        style={{ padding: 'var(--space-gutter)', gap: 'var(--space-row)' }}
      >
        {mensagens.length === 0 && (
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

          return (
            <div key={mensagem.id} className="flex flex-col">
              {primeiraNova && (
                <div
                  role="separator"
                  aria-label="Novas mensagens"
                  className="my-2 flex items-center gap-2 text-[11px] font-semibold text-accent"
                >
                  <span className="h-px flex-1 bg-accent" />
                  Novas mensagens
                  <span className="h-px flex-1 bg-accent" />
                </div>
              )}
              {trocouDeDia && (
                <div
                  role="separator"
                  className="my-2 flex items-center gap-2 text-[11px] text-fg-muted"
                >
                  <span className="h-px flex-1 bg-border-subtle" />
                  {DIA.format(new Date(mensagem.createdAt))}
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
              )}

              <article
                aria-busy={mensagem.envio === 'enviando' ? 'true' : undefined}
                className={mensagem.envio === 'enviando' ? 'opacity-60' : undefined}
              >
                {/*
                  A citacao vem ANTES do cabecalho porque e ela que da o
                  contexto: ler o nome de quem falou antes de saber a que se
                  responde inverte a ordem em que a frase faz sentido.

                  `replyToId` presente com a citada ausente e o caso normal de
                  mensagem apagada — o `SET NULL` do banco preserva a resposta
                  de proposito, e a linha diz isso em vez de sumir.
                */}
                {(mensagem.replyToId !== null && mensagem.replyToId !== undefined) && (
                  <p className="truncate border-l-2 border-border pl-2 text-[11px] text-fg-muted">
                    {citada === undefined
                      ? 'Em resposta a uma mensagem apagada'
                      : `Em resposta a ${nomeDe(citada.authorId)}: ${citada.content.slice(0, 80)}`}
                  </p>
                )}
                {!agrupada && (
                  <p className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-fg">
                      {nomeDe(mensagem.authorId)}
                    </span>
                    <time
                      dateTime={mensagem.createdAt}
                      className="font-mono text-[11px] text-fg-muted"
                    >
                      {HORA.format(new Date(mensagem.createdAt))}
                    </time>
                  </p>
                )}
                {/*
                  Foto sem legenda e mensagem legitima, e o servidor a aceita.
                  Um paragrafo vazio abriria um buraco de linha entre o nome e a
                  imagem, entao ele so existe quando ha texto.
                */}
                {mensagem.content !== '' && (
                  <p className="whitespace-pre-wrap break-words text-sm text-fg">
                    {mensagem.content}
                    {mensagem.editedAt !== null && (
                      <span className="ml-1 text-[11px] text-fg-muted">(editada)</span>
                    )}
                  </p>
                )}
                <Anexos anexos={mensagem.attachments ?? []} />

                {/*
                  Reagir e responder so existem para mensagem JA CONFIRMADA:
                  um eco otimista ainda nao tem id no servidor, e reagir a ele
                  bateria num 404.
                */}
                {mensagem.envio === undefined && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Reacoes
                      messageId={mensagem.id}
                      reacoes={mensagem.reactions ?? []}
                      eu={eu}
                    />
                    {aoResponder !== undefined && (
                      <button
                        type="button"
                        onClick={() => { aoResponder(mensagem) }}
                        className="text-[11px] text-fg-muted underline underline-offset-2
                                   hover:text-fg"
                      >
                        Responder
                      </button>
                    )}
                  </div>
                )}
                {mensagem.envio === 'falhou' && (
                  <p className="flex items-center gap-2 text-xs text-danger">
                    Nao foi enviada.
                    {/*
                      O reenvio leva o mesmo ID: se a primeira tentativa chegou
                      e so a resposta se perdeu, o servidor recusa a duplicata
                      em vez de aceitar duas vezes a mesma fala.
                    */}
                    <button
                      type="button"
                      onClick={() => void enviarMensagem(
                        mensagem.channelId, mensagem.content, mensagem.id,
                      )}
                      className="underline underline-offset-2"
                    >
                      Tentar de novo
                    </button>
                  </p>
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
                     bg-bg-raised px-3 py-1 text-xs text-fg shadow"
        >
          Novas mensagens
        </button>
      )}

      {/*
        Fora da regiao viva de proposito: digitacao e informacao de baixo valor
        e altissima frequencia, e anuncia-la seria ruido puro.
      */}
      {digitando !== undefined && digitando.length > 0 && (
        <p className="px-4 pb-1 text-[11px] text-fg-muted">
          {digitando.join(', ')} {digitando.length === 1 ? 'esta digitando' : 'estao digitando'}...
        </p>
      )}
    </div>
  )
}
