import { useState } from 'react'
import { Phone, PhoneOff, Volume2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { canalDeVoz, ehConversa, outroDaConversa, useStore } from '../../lib/store.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'
import { usePerfilAberto } from '../presence/perfilAberto.js'
import { Presenca, ROTULO_DE_PRESENCA } from '../presence/Presenca.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Dica } from '../../ui/Tooltip.js'
import { LARGURA_CHAT_NA_CHAMADA, usaLarguraMinima } from '../../lib/pontosDeQuebra.js'
import { MessageList } from '../messages/MessageList.js'
import { Composer } from '../messages/Composer.js'
import { PainelDeVoz } from '../voice/PainelDeVoz.js'
import type { Mensagem } from '../../lib/tipos.js'
import { useRascunhos } from '../messages/rascunhos.js'

/** Chamada primeiro: quem abriu um canal de voz veio pela transmissao. */
const ABAS = ['chamada', 'conversa'] as const

/** Referencia estavel para "ninguem na sala" — ver `PainelDeVoz`. */
const NINGUEM: ParticipanteDeVoz[] = []

/**
 * A coluna flexivel: cabecalho, historico e escrita.
 *
 * O nome do canal vive numa regiao de status porque trocar de canal precisa ser
 * anunciado - quem navega por teclado nao ve o destaque na barra lateral, e sem
 * o anuncio a troca acontece em silencio.
 */
export function Conversa({ campoEscrita, aoDigitar, antes, depois }: {
  campoEscrita: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
  /**
   * Os controles do cabecalho, entregues pelo shell — quem recolhe a coluna de
   * canais antes do titulo, quem busca e quem mostra os membros depois dele.
   *
   * Sao fatias, e nao propriedades soltas, porque o ESTADO e do shell: ele
   * sabe se a coluna esta recolhida, se virou gaveta e qual ponto de quebra
   * vale agora. Passar cinco booleanos e cinco callbacks para ca duplicaria
   * essa decisao em dois lugares, e um dia os dois discordariam.
   */
  antes?: ReactNode
  depois?: ReactNode
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const canal = useStore(e => e.channels.find(c => c.id === e.canalAtivo) ?? null)
  const [escrevendo, setEscrevendo] = useState(false)
  const ladoALado = usaLarguraMinima(LARGURA_CHAT_NA_CHAMADA)
  const [aba, setAba] = useState<(typeof ABAS)[number]>('chamada')
  const members = useStore(e => e.members)

  const definirResposta = useRascunhos(e => e.definirResposta)

  // Numa conversa direta o cabecalho e a PESSOA, e a chamada mora em cima do
  // historico — como em todo mensageiro —, e nao numa sala separada.
  const direta = useStore(e => ehConversa(e.groups.find(g => g.id === canal?.groupId)))
  const outro = useStore(e => (canal === null ? null : outroDaConversa(e, canal.groupId)))
  const voz = useStore(e => (direta && canal !== null ? canalDeVoz(e.channels, canal.groupId) : null))
  const naSala = useStore(e => (voz === null ? NINGUEM : e.chamadas[voz.id] ?? NINGUEM))
  const canalEmChamada = useChamadaAtiva(e => e.canal)
  const entrarNaChamada = useChamadaAtiva(e => e.entrar)
  const sairDaChamada = useChamadaAtiva(e => e.sair)
  const abrirPerfil = usePerfilAberto(e => e.abrirPerfil)
  const nestaChamada = voz !== null && canalEmChamada === voz.id
  // So no canal de TEXTO da conversa: aberta a propria sala de voz, o painel
  // ja ocupa a tela inteira e um segundo seria a mesma chamada duas vezes.
  const chamadaAqui = voz !== null && canal?.type === 'text' && (nestaChamada || naSala.length > 0)

  async function ligar(): Promise<void> {
    if (voz === null) return
    if (nestaChamada) { await sairDaChamada(); return }
    // Sair antes de entrar: duas sessoes de midia disputariam o microfone.
    if (canalEmChamada !== null) await sairDaChamada()
    await entrarNaChamada(voz.id)
  }

  const nomeDe = (autorId: string | null): string =>
    autorId === null
      ? 'usuário removido'
      : members.find(m => m.userId === autorId)?.displayName ?? 'usuário removido'

  /**
   * A quem estamos respondendo vai para o RASCUNHO do canal.
   *
   * Morava num `useState` daqui, e por isso sobrevivia a troca de canal: a
   * citacao de uma mensagem de #geral ia parar numa resposta em #avisos, e o
   * servidor recusava com 422 porque a citada era de outro canal.
   */
  const responder = (m: Mensagem): void => {
    if (canalAtivo === null) return
    definirResposta(canalAtivo, {
      id: m.id,
      autor: nomeDe(m.authorId),
      // Um trecho, e nao a mensagem inteira: a barra de citacao nao pode
      // empurrar o campo de escrita para fora da tela.
      trecho: m.content.slice(0, 60),
    })
    campoEscrita.current?.focus()
  }

  return (
    <section
      id="conversa"
      aria-label="Conversa"
      /*
        `h-full min-h-0` nao e redundante com `flex-1`.

        Esta secao e filha direta de um `Panel`, que a biblioteca cria SEM
        declarar `display` — logo, um bloco. Um `flex-1` ali dentro nao governa
        nada, e a secao crescia ate o conteudo: 1852px dentro de uma coluna de
        948px. Tudo abaixo herdava a altura errada, o painel de voz parava de
        rolar e os botoes da chamada caiam fora do recorte.

        `h-full` e quem da a altura de verdade; `min-h-0` e quem permite que os
        filhos encolham em vez de estourar. O `flex-1` fica para quando esta
        secao for usada dentro de um pai flex de verdade.
      */
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      {/*
        O cabecalho do CANAL, e nao mais uma barra global.

        Antes havia uma unica faixa de 56px no topo da janela servindo as
        quatro colunas ao mesmo tempo: ela carregava o botao de recolher
        canais, o nome do grupo, o nome do canal, a busca, os membros e o
        avatar. Uma barra que fala por todo mundo nao pertence a ninguem — e o
        nome do grupo, em particular, ficava longe da coluna de canais que ele
        nomeia. Agora cada coluna tem o proprio topo, e este aqui responde
        apenas "qual canal e este, e o que posso fazer nele".
      */}
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-2"
      >
        {antes}
        {direta ? (
          <button
            type="button"
            onClick={() => { if (outro !== null) abrirPerfil(outro.userId) }}
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 hover:bg-bg-hover"
          >
            <span className="relative flex shrink-0">
              <Avatar nome={outro?.displayName ?? 'Conta removida'} url={outro?.avatarUrl ?? null} tamanho="sm" />
              <Presenca status={outro?.status ?? 'offline'} modo="cracha" />
            </span>
            <h1 className="min-w-0 truncate text-sm font-semibold text-fg">
              {outro?.displayName ?? 'Conta removida'}
            </h1>
            <span className="hidden text-xs text-fg-muted sm:inline">
              {ROTULO_DE_PRESENCA[outro?.status ?? 'offline']}
            </span>
          </button>
        ) : (
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg">
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
        )}
        {/*
          O titulo da estrutura ao documento; o anuncio e uma regiao de status
          separada porque `role=status` nao e permitido num cabecalho — e
          porque o que interessa ouvir na troca e a frase, nao o cerquilha.
        */}
        <p role="status" aria-label="Canal atual" className="sr-only">
          {canal === null ? 'Nenhum canal selecionado'
            : direta ? `Conversa com ${outro?.displayName ?? 'conta removida'}`
              : `Canal ${canal.type === 'voice' ? 'de voz ' : ''}${canal.name}`}
        </p>
        {!direta && canal?.topic !== null && canal !== null ? (
          <p className="min-w-0 flex-1 truncate border-l border-border-subtle pl-3 text-xs text-fg-muted">
            {canal.topic}
          </p>
        ) : <span className="flex-1" />}

        {direta && voz !== null && (
          <Dica texto={nestaChamada ? 'Sair da chamada' : 'Ligar'} lado="bottom">
            <Botao
              variante={nestaChamada ? 'perigo' : 'fantasma'}
              tamanho="iconeSm"
              onClick={() => { void ligar() }}
             
            >
              {nestaChamada
                ? <PhoneOff aria-hidden="true" strokeWidth={1.75} />
                : <Phone aria-hidden="true" strokeWidth={1.75} />}
              <span className="sr-only">
                {nestaChamada ? 'Sair da chamada' : `Ligar para ${outro?.displayName ?? 'esta pessoa'}`}
              </span>
            </Botao>
          </Dica>
        )}
        {depois === undefined ? null : (
          <span className="flex shrink-0 items-center gap-1">{depois}</span>
        )}
      </header>

      {/*
        A chamada de uma conversa aparece EM CIMA do historico, e so enquanto
        existe: ninguem precisa trocar de tela para atender, e o texto continua
        a um olhar de distancia.
      */}
      {chamadaAqui && voz !== null && (
        <div className="flex max-h-[60%] min-h-[14rem] shrink-0 flex-col border-b border-border-subtle bg-bg-sunken">
          <PainelDeVoz channelId={voz.id} nomeDoCanal={`Chamada com ${outro?.displayName ?? 'conta removida'}`} />
        </div>
      )}

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
            desativado={canalAtivo === null}
          />
        </>
      )}
    </section>
  )
}
