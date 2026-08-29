import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useStore } from '../../lib/store.js'
import { MessageList } from '../messages/MessageList.js'
import { Composer } from '../messages/Composer.js'
import { PainelDeVoz } from '../voice/PainelDeVoz.js'

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
        Canal de voz nao tem historico nem escrita: mostrar um composer
        desabilitado embaixo da chamada seria oferecer uma acao que o canal nao
        tem. O tipo do canal decide a coluna inteira.
      */}
      {canal?.type === 'voice' && canalAtivo !== null ? (
        <PainelDeVoz channelId={canalAtivo} nomeDoCanal={canal.name} />
      ) : (
        <>
          <MessageList escrevendo={escrevendo} />

          <Composer
            campo={campoEscrita}
            {...(aoDigitar === undefined ? {} : { aoDigitar })}
            aoFocar={() => setEscrevendo(true)}
            aoDesfocar={() => setEscrevendo(false)}
            desativado={canalAtivo === null}
          />
        </>
      )}
    </section>
  )
}
