import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useStore } from '../../lib/store.js'
import { LARGURA_CHAT_NA_CHAMADA, usaLarguraMinima } from '../../lib/pontosDeQuebra.js'
import { MessageList } from '../messages/MessageList.js'
import { Composer } from '../messages/Composer.js'
import { PainelDeVoz } from '../voice/PainelDeVoz.js'
import type { Mensagem } from '../../lib/tipos.js'

/** Chamada primeiro: quem abriu um canal de voz veio pela transmissao. */
const ABAS = ['chamada', 'conversa'] as const

/**
 * A coluna flexivel: cabecalho, historico e escrita.
 *
 * O nome do canal vive numa regiao de status porque trocar de canal precisa ser
 * anunciado - quem navega por teclado nao ve o destaque na barra lateral, e sem
 * o anuncio a troca acontece em silencio.
 */
export function Conversa({ campoEscrita, aoDigitar }: {
  campoEscrita: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const canal = useStore(e => e.channels.find(c => c.id === e.canalAtivo) ?? null)
  const [escrevendo, setEscrevendo] = useState(false)
  const ladoALado = usaLarguraMinima(LARGURA_CHAT_NA_CHAMADA)
  const [aba, setAba] = useState<(typeof ABAS)[number]>('chamada')
  const members = useStore(e => e.members)

  /**
   * A quem estamos respondendo.
   *
   * Mora AQUI, e nao dentro do composer nem da lista, porque e o unico ponto
   * que os dois enxergam: quem clica em "Responder" esta na lista, e quem
   * envia esta no composer. Guardar num dos dois obrigaria o outro a alcancar
   * por dentro.
   */
  const [respondendo, setRespondendo] = useState<
    { id: string; autor: string; trecho: string } | null
  >(null)

  const nomeDe = (autorId: string | null): string =>
    autorId === null
      ? 'usuario removido'
      : members.find(m => m.userId === autorId)?.displayName ?? 'usuario removido'

  const responder = (m: Mensagem): void => {
    setRespondendo({
      id: m.id,
      autor: nomeDe(m.authorId),
      // Um trecho, e nao a mensagem inteira: a barra de citacao nao pode
      // empurrar o campo de escrita para fora da tela.
      trecho: m.content.slice(0, 60),
    })
    campoEscrita.current?.focus()
  }

  const limparResposta = (): void => { setRespondendo(null) }

  return (
    <section
      id="conversa"
      aria-label="Conversa"
      className="flex min-w-0 flex-1 flex-col"
    >
      <header
        className="flex shrink-0 items-baseline gap-3 border-b border-border-subtle px-4 py-2"
      >
        <h1 className="text-sm font-semibold text-fg">
          {/*
            O cerquilha e o alto-falante sao decorativos: o rotulo de status
            abaixo ja diz "Canal de voz X" por extenso, e repetir o simbolo no
            leitor de tela nao acrescenta nada.
          */}
          {canal !== null && (canal.type === 'voice'
            ? <Volume2 aria-hidden="true" className="inline size-4 align-[-2px]" />
            : <span aria-hidden="true">#</span>)}
          {canal === null ? 'Nenhum canal' : ` ${canal.name}`}
        </h1>
        {/*
          O titulo da estrutura ao documento; o anuncio e uma regiao de status
          separada porque `role=status` nao e permitido num cabecalho — e
          porque o que interessa ouvir na troca e a frase, nao o cerquilha.
        */}
        <p role="status" aria-label="Canal atual" className="sr-only">
          {canal === null ? 'Nenhum canal selecionado'
            : `Canal ${canal.type === 'voice' ? 'de voz ' : ''}${canal.name}`}
        </p>
        {canal?.topic !== null && canal !== null && (
          <p className="truncate text-xs text-fg-muted">{canal.topic}</p>
        )}
      </header>

      {/*
        Canal de voz TEM historico e escrita.

        A decisao anterior — voz sem conversa — estava certa enquanto a chamada
        era uma chamada. Ela dependia de "canal de voz nao tem historico", que e
        uma decisao nossa e nao uma lei: assim que a chamada virou transmissao,
        a conversa DURANTE ela passou a ser metade do produto, como e no Twitch
        e no Discord todo dia.

        E o mesmo `messages`, com o mesmo `channelId` e o mesmo fan-out do
        WebSocket — nao um chat efemero paralelo. E por isso que isto custou
        zero linha de servidor: nenhuma rota da API jamais recusou escrita em
        canal de voz.
      */}
      {canal?.type === 'voice' && canalAtivo !== null ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/*
              Abaixo do ponto de quebra o chat vira uma ABA sobre o palco.
              Dividir 360px de largura entre video e conversa nao entrega
              nenhum dos dois.
            */}
            {!ladoALado && (
              <div
                role="tablist"
                aria-label="Chamada ou conversa"
                className="flex shrink-0 gap-1 border-b border-border-subtle px-2"
              >
                {ABAS.map(nome => (
                  <button
                    key={nome}
                    type="button"
                    role="tab"
                    aria-selected={aba === nome}
                    onClick={() => setAba(nome)}
                    className={`px-3 text-sm capitalize ${aba === nome
                      ? 'border-b-2 border-accent text-fg'
                      : 'text-fg-muted hover:text-fg'}`}
                    style={{ minHeight: 'var(--height-row)' }}
                  >
                    {nome}
                  </button>
                ))}
              </div>
            )}

            {(ladoALado || aba === 'chamada') && (
              <PainelDeVoz channelId={canalAtivo} nomeDoCanal={canal.name} />
            )}

            {!ladoALado && aba === 'conversa' && (
              <>
                <MessageList escrevendo={escrevendo} aoResponder={responder} />
                <Composer
                  campo={campoEscrita}
                  {...(aoDigitar === undefined ? {} : { aoDigitar })}
                  aoFocar={() => setEscrevendo(true)}
                  aoDesfocar={() => setEscrevendo(false)}
                  respondendo={respondendo}
                  aoCancelarResposta={limparResposta}
                />
              </>
            )}
          </div>

          {ladoALado && (
            <div
              className="flex min-h-0 shrink-0 flex-col border-l border-border-subtle"
              style={{ width: 'var(--w-channels)' }}
            >
              <MessageList escrevendo={escrevendo} aoResponder={responder} />
              <Composer
                campo={campoEscrita}
                {...(aoDigitar === undefined ? {} : { aoDigitar })}
                aoFocar={() => setEscrevendo(true)}
                aoDesfocar={() => setEscrevendo(false)}
                respondendo={respondendo}
                aoCancelarResposta={limparResposta}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <MessageList escrevendo={escrevendo} aoResponder={responder} />

          <Composer
            campo={campoEscrita}
            {...(aoDigitar === undefined ? {} : { aoDigitar })}
            aoFocar={() => setEscrevendo(true)}
            aoDesfocar={() => setEscrevendo(false)}
            respondendo={respondendo}
            aoCancelarResposta={limparResposta}
            desativado={canalAtivo === null}
          />
        </>
      )}
    </section>
  )
}
