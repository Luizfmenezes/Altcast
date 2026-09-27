import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Grid2x2, HeadphoneOff, Headphones, Loader2, Mic, MicOff, MonitorUp, Pin, RotateCw,
  Video, VideoOff, PhoneOff, Volume2, WifiOff,
} from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import { Avatar } from '../../ui/Avatar.js'
import { AnelDeFala } from '../../ui/bits/AnelDeFala.js'
import { useStore } from '../../lib/store.js'
import { ControleDeVolume, FaixaDeMidia } from './FaixaDeMidia.js'
import { useChamada } from './useChamada.js'
import { ConfiguracaoDeMidia } from './ConfiguracaoDeMidia.js'
import {
  ESPERA_DE_FALA_MS, MEMORIA_INICIAL, escolherPalco, guardarModo, idDaFaixa, lerModo,
} from './palco.js'
import { chaveDeVolume } from '../../lib/midia.js'
import { nativo } from '../../lib/nativo.js'
import { SeletorDeFonte } from './SeletorDeFonte.js'
import { useDialogoDeConfiguracoes } from '../settings/dialogoDeConfiguracoes.js'
import { rotuloDaSituacao, situacaoDaChamada } from './situacao.js'
import type { SomDaTela } from '../../lib/nativo.js'
import type { ModoDaChamada } from './palco.js'
import type { ParticipanteDeVoz } from '../../lib/store.js'
import type { Faixa, PapelSonoro, QualidadeDeRecepcao, Sinal } from '../../lib/midia.js'

/**
 * Uma referencia estavel para "ninguem na chamada".
 *
 * Sem ela, o seletor `e.chamadas[id] ?? []` devolveria um array NOVO a cada
 * render; o zustand compara por identidade, concluiria que mudou toda vez, e o
 * componente entraria em laco infinito ate travar a aba.
 */
const NINGUEM: ParticipanteDeVoz[] = []

/**
 * O sinal desenhado com caracteres, e nao com tres divs.
 *
 * A informacao util aqui e ordinal — melhor ou pior —, e o texto ja a carrega
 * sem depender de cor. Quem enxerga ve as barras encherem; quem usa leitor de
 * tela ouve o rotulo por extenso ao lado.
 */
const SINAL_EM_BARRAS: Record<Sinal, string> = {
  excelente: '▁▄█',
  bom: '▁▄▁',
  ruim: '▁▁▁',
  perdido: '✕',
}

/**
 * O canal de voz.
 *
 * Duas listas se sobrepoem aqui de proposito. A de PARTICIPANTES vem do
 * WebSocket da API e existe mesmo para quem nao entrou na chamada — e o que
 * deixa alguem ver que a reuniao ja comecou antes de decidir entrar. A de
 * FAIXAS vem do SFU e so existe para quem entrou. Uma sala com tres pessoas
 * mostra tres nomes para quem esta de fora, e tres nomes mais os videos para
 * quem esta dentro.
 */
export function PainelDeVoz({ channelId, nomeDoCanal }: {
  channelId: string
  nomeDoCanal: string
}): ReactNode {
  const {
    estado, aqui, entrar, tentarDeNovo, sair, alternarMicrofone, alternarCamera, alternarTela, trocarDispositivo,
    destravarAudio, definirVolume, restaurarVolumes, definirQualidade,
    definirQualidadeDeRecepcao, alternarSurdo,
  } = useChamada(channelId)
  const participantes = useStore(e => e.chamadas[channelId]) ?? NINGUEM
  const members = useStore(e => e.members)
  const eu = useStore(e => e.user)
  const abrirConfiguracoes = useDialogoDeConfiguracoes(e => e.abrir)

  const nomeDe = (userId: string): string =>
    userId === eu?.id
      ? 'Você'
      : members.find(m => m.userId === userId)?.displayName ?? 'Alguém'

  const dentro = estado.fase === 'dentro'
  /** A mesma leitura da barra do rodape: as duas nunca mais discordam. */
  const situacao = situacaoDaChamada(aqui ? channelId : null, estado)
  const ehSom = (papel: string): boolean => papel === 'audio' || papel === 'audio-tela'
  const videos = estado.faixas.filter(f => !ehSom(f.papel))
  const audios = estado.faixas.filter(f => ehSom(f.papel))

  const [modo, setModo] = useState<ModoDaChamada>(lerModo)
  const [fixado, setFixado] = useState<string | null>(null)
  /**
   * A memoria da histerese. Fica num `ref` porque ela nao pinta nada: o que a
   * tela mostra e o palco escolhido, e guardar o cronometro em estado faria
   * cada tique de fala disparar um render sem mudar um pixel.
   */
  const memoria = useRef(MEMORIA_INICIAL)
  /** O anuncio da troca MANUAL de palco. A automatica nunca anuncia. */
  const [anuncioDoPalco, setAnuncioDoPalco] = useState('')

  /**
   * O seletor de tela do app de desktop.
   *
   * `ponte` e `null` no navegador, e entao nada disto existe: o caminho de
   * sempre continua sendo o do Chrome, com a caixa dele. E a mesma interface
   * servida nos dois lugares — a diferenca e uma capacidade presente ou
   * ausente, nunca um build separado.
   */
  const ponte = nativo()
  const [seletorAberto, setSeletorAberto] = useState(false)

  /**
   * Escolher a fonte ANTES de capturar, e nao durante.
   *
   * O processo principal guarda a escolha e a consome no `getDisplayMedia` que
   * o LiveKit dispara em seguida — por isso o `await` importa: comecar a
   * captura antes de a escolha chegar do outro lado faria o handler nao achar
   * nada e negar, e o sintoma seria um botao que as vezes nao funciona.
   *
   * A ordem tambem e o que faz CANCELAR nao virar erro. No caminho oposto — o
   * seletor aparecer durante a captura — desistir rejeita a promessa do
   * `getDisplayMedia`, e `midia.ts` traduz isso para "O navegador nao liberou
   * o dispositivo". Desistir de escolher uma janela nao e falha de dispositivo.
   */
  async function compartilharFonte(id: string, som: SomDaTela): Promise<void> {
    if (ponte === null) return
    await ponte.escolherFonte(id, som)
    alternarTela()
  }

  /**
   * O relogio da histerese.
   *
   * `ActiveSpeakersChanged` avisa quando o conjunto de falantes MUDA, e nao a
   * cada instante em que alguem continua falando. Sem este disparo, quem
   * comeca a falar e nao para nunca cruzaria os dois segundos: o evento que
   * iniciou a contagem seria o ultimo, e o palco jamais trocaria.
   *
   * Um temporizador por mudanca de falante, e nao um intervalo permanente: ele
   * so precisa existir no unico instante em que a espera se cumpre.
   */
  const [, setTique] = useState(0)
  useEffect(() => {
    if (estado.falando.length === 0) return
    const t = setTimeout(() => { setTique(n => n + 1) }, ESPERA_DE_FALA_MS + 50)
    return () => { clearTimeout(t) }
  }, [estado.falando])

  const escolha = escolherPalco({
    videos,
    falando: estado.falando,
    fixado,
    agora: Date.now(),
    memoria: memoria.current,
  })
  memoria.current = escolha.memoria

  const emPalco = videos.find(v => idDaFaixa(v) === escolha.palco) ?? null
  const naFita = videos.filter(v => idDaFaixa(v) !== escolha.palco)

  /**
   * Fixar e desfixar.
   *
   * Clicar no que ja esta fixado DESFIXA, e nao refixa: um botao de estado que
   * so liga deixa a pessoa presa na escolha que ela mesma fez, sem caminho de
   * volta para o automatico.
   */
  function alternarFixado(faixa: Faixa, legenda: string): void {
    const id = idDaFaixa(faixa)
    const desfixando = fixado === id
    setFixado(desfixando ? null : id)
    // So a troca manual anuncia. Anunciar cada troca automatica transformaria
    // o leitor de tela numa metralhadora numa sala com quatro pessoas
    // conversando — o mesmo motivo pelo qual as entradas na chamada tambem nao
    // sao anunciadas uma a uma.
    setAnuncioDoPalco(desfixando
      ? 'Palco automático'
      : `${legenda} no palco`)
  }

  const legendaDe = (faixa: Faixa): string =>
    faixa.papel === 'tela' ? `${nomeDe(faixa.userId)} — tela` : nomeDe(faixa.userId)

  /**
   * Um volume nao ajustado e 1, e nao 0: o padrao de uma sala e todo mundo se
   * ouvindo. O `??` cobre tanto quem nunca foi ajustado quanto quem foi
   * ajustado num navegador em que o armazenamento esta bloqueado.
   */
  const volumeDe = (userId: string, papel: PapelSonoro): number =>
    estado.volumes[chaveDeVolume(userId, papel)] ?? 1

  /**
   * A qualidade que EU recebo desta faixa.
   *
   * Nunca na propria transmissao: nao ha o que negociar com o proprio
   * navegador, e o quadro que a pessoa ve de si mesma nem passa pelo SFU.
   */
  const qualidadeDaFaixa = (faixa: Faixa): {
    qualidade?: QualidadeDeRecepcao
    aoMudarQualidade?: (n: QualidadeDeRecepcao) => void
  } => {
    const sid = faixa.track.sid
    if (faixa.local || sid === undefined) return {}
    return {
      qualidade: estado.recepcao[sid] ?? 'automatica',
      aoMudarQualidade: (n: QualidadeDeRecepcao) => { definirQualidadeDeRecepcao(sid, n) },
    }
  }

  /**
   * O som de uma tela compartilhada pertence a ELA, e nao a quem a transmite:
   * quem baixa o volume de um jogo que estao mostrando nao quer, com isso,
   * deixar de ouvir a pessoa comentando o jogo. Por isso o controle do
   * `audio-tela` mora no quadro do video, e o do microfone mora na lista de
   * participantes — sao duas fontes independentes da mesma pessoa.
   */
  const volumeDaTela = (faixa: { userId: string; papel: string; local: boolean }): {
    volume?: number
    aoMudarVolume?: (v: number) => void
  } => {
    if (faixa.papel !== 'tela' || faixa.local) return {}
    // Sem faixa de som publicada nao ha o que ajustar. Mostrar o cursor assim
    // mesmo prometeria um controle sobre um silencio.
    const temSom = audios.some(a => a.userId === faixa.userId && a.papel === 'audio-tela')
    if (!temSom) return {}
    return {
      volume: volumeDe(faixa.userId, 'audio-tela'),
      aoMudarVolume: (v: number) => { definirVolume(faixa.userId, 'audio-tela', v) },
    }
  }

  return (
    <section
      aria-label={`Chamada de ${nomeDoCanal}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      {/*
        Uma unica regiao de status para a chamada inteira. Anunciar cada entrada
        e cada camera separadamente transformaria uma reuniao de seis pessoas
        numa metralhadora de avisos.
      */}
      <p role="status" className="sr-only">
        {situacao === 'conectado'
          ? `No ar, ${String(participantes.length)} participantes`
          : rotuloDaSituacao(situacao, null)}
      </p>

      {/*
        O nome do canal, e o estado da conexao ao lado dele.

        O nome se decifrava letra a letra na entrada. Era bonito uma vez e
        ruido nas outras cem: numa tela de trabalho, movimento tem de dizer
        que algo MUDOU de estado — e o nome de uma sala nao muda.
      */}
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Volume2 aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 truncate">{nomeDoCanal}</span>
        {situacao !== 'ocioso' && situacao !== 'falhou' ? (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5
                        text-xs font-medium ${situacao === 'conectado'
              ? 'border-accent-live/40 text-fg'
              : 'border-border-subtle text-fg-muted'}`}
          >
            {situacao === 'conectado'
              ? <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-live" />
              : <Loader2 aria-hidden="true" className="size-3 motion-safe:animate-spin" />}
            {situacao === 'conectado' ? 'no ar'
              : situacao === 'reconectando' ? 'reconectando' : 'conectando'}
          </span>
        ) : null}
      </h2>

      {/*
        O navegador segurou a reproducao. Isto e um BOTAO, e nao um aviso, por
        uma razao tecnica: a politica de autoplay so libera o som dentro de um
        gesto da pessoa, entao o unico jeito de destravar e ela clicar.
      */}
      {estado.audioBloqueado && (
        <Botao onClick={destravarAudio}>
          <Volume2 aria-hidden="true" className="size-4" />
          Ativar o som da chamada
        </Botao>
      )}

      {/*
        A falha COM SAIDA. Antes era uma frase vermelha e nada mais: "Nao foi
        possivel conectar ao servidor de midia", e a pessoa tinha de adivinhar
        que o proximo passo era clicar em "Entrar" de novo — ou que o problema
        era o microfone.
      */}
      {situacao === 'falhou' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/60 p-3">
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm text-fg">{estado.erro ?? 'Não foi possível conectar à chamada.'}</p>
            {/*
              As duas saidas moram onde ja estavam: "Tentar de novo" no rodape,
              no lugar de "Entrar", e os dispositivos no painel logo abaixo —
              um segundo botao com o mesmo nome aqui dizia a mesma coisa duas
              vezes, a um palmo de distancia.
            */}
            <p className="mt-1 text-xs text-fg-muted">
              Tente de novo pelo botão abaixo, ou confira microfone e saída de som em{' '}
              <button
                type="button"
                onClick={() => abrirConfiguracoes('midia')}
                className="font-medium text-accent underline underline-offset-2"
              >
                Áudio e vídeo
              </button>
              .
            </p>
          </div>
        </div>
      )}

      {/* Erro de DISPOSITIVO dentro de uma chamada que continua de pe. */}
      {situacao !== 'falhou' && estado.erro !== null && (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-sm text-danger">
          {estado.erro}
        </p>
      )}

      {participantes.length === 0 && !dentro && situacao !== 'falhou' && (
        <p className="text-sm text-fg-muted">
          Ninguém na chamada ainda. Entre para começar.
        </p>
      )}

      {/* A troca manual de palco, anunciada. A automatica, nunca. */}
      <p role="status" className="sr-only">{anuncioDoPalco}</p>

      {videos.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/*
              Sem isto a fixacao seria uma porta de mao unica: o que esta
              fixado sobe ao palco e SAI da fita, entao o botao que o fixou
              deixa de existir — e a pessoa fica presa na propria escolha sem
              nenhum caminho de volta ao automatico.
            */}
            {fixado !== null && modo === 'palco' && (
              <Botao
                variante="discreto"
                onClick={() => {
                  setFixado(null)
                  setAnuncioDoPalco('Palco automático')
                }}
              >
                <Pin aria-hidden="true" className="size-4" />
                Desafixar do palco
              </Botao>
            )}
            {/*
              A saida de emergencia do palco automatico. Um palpite que erra e
              pior do que uma grade que nao decide nada, e a pessoa para quem
              ele errar precisa de um caminho de volta que nao dependa de nos
              consertarmos a regra.
            */}
            <Botao
              variante="discreto"
              aria-pressed={modo === 'grade'}
              onClick={() => {
                const proximo = modo === 'grade' ? 'palco' : 'grade'
                setModo(proximo)
                guardarModo(proximo)
              }}
            >
              <Grid2x2 aria-hidden="true" className="size-4" />
              {modo === 'grade' ? 'Ver em palco' : 'Ver em grade'}
            </Botao>
          </div>

          {modo === 'grade' ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {videos.map(faixa => (
                <FaixaDeMidia
                  key={idDaFaixa(faixa)}
                  faixa={faixa}
                  rotulo={nomeDe(faixa.userId)}
                  {...volumeDaTela(faixa)}
                  {...qualidadeDaFaixa(faixa)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {emPalco !== null && (
                <FaixaDeMidia
                  key={idDaFaixa(emPalco)}
                  faixa={emPalco}
                  rotulo={nomeDe(emPalco.userId)}
                  tamanho="palco"
                  {...volumeDaTela(emPalco)}
                  {...qualidadeDaFaixa(emPalco)}
                />
              )}

              {/*
                A fita e uma lista de botoes DE VERDADE, e nao quadros com um
                `onClick`: sem isso ela seria invisivel para o teclado, que e
                justamente o caminho de quem mais precisa escolher o que fica
                grande na tela.

                O botao cobre a miniatura inteira em vez de morar dentro dela.
                Um `<figure>` com video nao e conteudo valido para `<button>`, e
                aninhar os dois criaria um alvo clicavel dentro de outro.
              */}
              {naFita.length > 0 && (
                <ul aria-label="Outras transmissões" className="flex gap-2 overflow-x-auto pb-1">
                  {naFita.map(faixa => {
                    const id = idDaFaixa(faixa)
                    const legenda = legendaDe(faixa)
                    return (
                      <li key={id} className="relative w-40 shrink-0">
                        <FaixaDeMidia
                          faixa={faixa}
                          rotulo={nomeDe(faixa.userId)}
                          tamanho="miniatura"
                        />
                        <button
                          type="button"
                          onClick={() => { alternarFixado(faixa, legenda) }}
                          aria-pressed={fixado === id}
                          aria-label={`Fixar ${legenda} no palco`}
                          title={`Fixar ${legenda} no palco`}
                          className="absolute inset-0 rounded border-2 border-transparent
                                     hover:border-accent focus-visible:border-accent
                                     aria-pressed:border-accent"
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* Fora da grade: audio nao ocupa espaco, so precisa existir. */}
      {audios.map(faixa => (
        <FaixaDeMidia key={idDaFaixa(faixa)} faixa={faixa} rotulo={nomeDe(faixa.userId)} />
      ))}

      <ul className="flex flex-col">
        {participantes.map(p => (
          <li
            key={p.userId}
            aria-label={`${nomeDe(p.userId)}, ${p.microfone ? 'microfone ligado' : 'microfone desligado'}`}
            className="group flex items-center gap-2 rounded px-2 text-sm"
            style={{ minHeight: 'var(--height-row)' }}
          >
            {/*
              O icone repete o que o rotulo do item ja diz, entao ele e
              decorativo: anuncia-lo de novo seria ouvir a mesma coisa duas
              vezes.
            */}
            {/*
              O anel "no ar" em volta de quem fala: a assinatura do sistema. O
              proprio nivel e medido; o dos outros vem do SFU como "falando".
            */}
            <AnelDeFala
              falando={estado.falando.includes(p.userId)}
              nivel={p.userId === eu?.id ? estado.nivel * 4 : 1}
            >
              <Avatar
                nome={nomeDe(p.userId)}
                url={members.find(m => m.userId === p.userId)?.avatarUrl ?? null}
                tamanho="sm"
              />
            </AnelDeFala>
            <span className="min-w-0 truncate text-fg">{nomeDe(p.userId)}</span>
            {p.microfone
              ? <Mic aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
              : <MicOff aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted/70" />}
            {p.tela && <MonitorUp aria-hidden="true" className="size-4 text-fg-muted" />}

            {/*
              A forca do sinal, quando o SFU ja disse alguma coisa. Sem ela,
              "o video de fulano esta ruim" nao distingue a camera dele da rede
              dele — e as duas pedem providencias opostas.

              O texto e o rotulo, e nao um `title`: um icone cuja unica
              explicacao aparece sob o ponteiro nao existe para quem usa
              teclado, toque ou leitor de tela.
            */}
            {estado.sinais[p.userId] !== undefined && (
              <span
                aria-label={`Sinal ${estado.sinais[p.userId] ?? ''}`}
                title={`Sinal ${estado.sinais[p.userId] ?? ''}`}
                className={`text-xs ${
                  estado.sinais[p.userId] === 'excelente' || estado.sinais[p.userId] === 'bom'
                    ? 'text-fg-muted'
                    : 'text-danger'}`}
              >
                {SINAL_EM_BARRAS[estado.sinais[p.userId] ?? 'bom']}
              </span>
            )}

            {/*
              O volume do MICROFONE desta pessoa. Fica na lista, e nao no
              quadro de video, porque a maior parte de uma sala de voz nao tem
              video nenhum — amarrar o controle a um quadrado deixaria sem
              ajuste justamente o caso comum.

              So aparece dentro da chamada: fora dela nao existe faixa de audio
              nenhuma, e um cursor que nao move som e pior do que a ausencia
              dele.
            */}
            {dentro && p.userId !== eu?.id && (
              <span
                className="ml-auto flex items-center opacity-0 transition-opacity
                           focus-within:opacity-100 group-hover:opacity-100
                           [@media(hover:none)]:opacity-100"
              >
                <ControleDeVolume
                  tom="lista"
                  rotulo={nomeDe(p.userId)}
                  volume={volumeDe(p.userId, 'audio')}
                  aoMudar={v => { definirVolume(p.userId, 'audio', v) }}
                />
              </span>
            )}
          </li>
        ))}
      </ul>

      {/*
        Disponivel tambem FORA da chamada: escolher o microfone antes de entrar
        e o que evita a primeira frase sair pelo dispositivo errado.
      */}
      <ConfiguracaoDeMidia
        nivel={estado.nivel}
        microfoneLigado={estado.microfone}
        aoTrocar={trocarDispositivo}
        qualidade={estado.qualidade}
        aoTrocarQualidade={definirQualidade}
        compartilhandoTela={estado.tela}
        aoRestaurarVolumes={restaurarVolumes}
      />

      {/*
        Grudada no rodape do proprio rolador, e nao apenas empurrada por
        `mt-auto`.

        `mt-auto` sozinho depende de SOBRAR espaco. Numa chamada com seis
        pessoas, um palco aberto e a configuracao de midia expandida nao sobra
        — a margem resolve para zero e a barra desce junto com o conteudo ate
        sair de vista. Sair da chamada e justamente o controle que nunca pode
        exigir que alguem role ate o fim para encontrar.

        O `-mx-4 px-4` devolve o respiro que o `p-4` da secao dava, e o fundo
        solido e o que impede o conteudo de aparecer por baixo enquanto rola.
      */}
      <div
        className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center gap-2
                   border-t border-border-subtle bg-bg px-4 pb-1 pt-3"
      >
        {!dentro ? (
          situacao === 'falhou' ? (
            // O mesmo lugar do "Entrar na chamada": quem falhou procura a
            // tentativa seguinte onde a primeira estava.
            <>
              <Botao onClick={tentarDeNovo}>
                <RotateCw aria-hidden="true" className="size-4" />
                Tentar de novo
              </Botao>
              <Botao variante="discreto" onClick={sair}>
                <PhoneOff aria-hidden="true" className="size-4" />
                Desistir
              </Botao>
            </>
          ) : (
            <Botao onClick={entrar} disabled={situacao === 'conectando'}>
              {situacao === 'conectando' ? 'Entrando…' : 'Entrar na chamada'}
            </Botao>
          )
        ) : (
          <>
            <Botao
              variante="discreto"
              onClick={alternarMicrofone}
              disabled={!estado.podePublicar}
              aria-pressed={estado.microfone}
              // Quem so escuta precisa saber POR QUE o botao esta apagado.
              // Um controle desabilitado sem explicacao parece defeito.
              title={estado.podePublicar ? undefined : 'Você não pode transmitir neste canal'}
            >
              {estado.microfone
                ? <Mic aria-hidden="true" className="size-4" />
                : <MicOff aria-hidden="true" className="size-4" />}
              {estado.microfone ? 'Microfone ligado' : 'Microfone desligado'}
            </Botao>

            <Botao
              variante="discreto"
              onClick={alternarCamera}
              disabled={!estado.podePublicar}
              aria-pressed={estado.camera}
            >
              {estado.camera
                ? <Video aria-hidden="true" className="size-4" />
                : <VideoOff aria-hidden="true" className="size-4" />}
              {estado.camera ? 'Câmera ligada' : 'Câmera desligada'}
            </Botao>

            <Botao
              variante="discreto"
              onClick={() => {
                // Parar de compartilhar nunca abre seletor: nao ha o que
                // escolher para desligar.
                if (ponte !== null && !estado.tela) {
                  setSeletorAberto(true)
                  return
                }
                alternarTela()
              }}
              disabled={!estado.podePublicar}
              aria-pressed={estado.tela}
            >
              <MonitorUp aria-hidden="true" className="size-4" />
              {estado.tela ? 'Parar de compartilhar' : 'Compartilhar tela'}
            </Botao>

            {/*
              Ensurdecer silencia a sala inteira de uma vez — e o microfone
              junto, que e o que a palavra significa em toda ferramenta que a
              usa. Nao desfaz os volumes individuais: e um interruptor por
              cima deles.
            */}
            <Botao
              variante="discreto"
              onClick={alternarSurdo}
              aria-pressed={estado.surdo}
            >
              {estado.surdo
                ? <HeadphoneOff aria-hidden="true" className="size-4" />
                : <Headphones aria-hidden="true" className="size-4" />}
              {estado.surdo ? 'Ensurdecido' : 'Ouvindo a sala'}
            </Botao>

            <Botao variante="perigo" onClick={sair}>
              <PhoneOff aria-hidden="true" className="size-4" />
              Sair
            </Botao>
          </>
        )}
      </div>

      {/*
        So no app. No navegador o seletor do Chrome ja faz este trabalho, e um
        segundo dialogo antes dele seria uma escolha pedida duas vezes.
      */}
      {ponte !== null && (
        <SeletorDeFonte
          aberto={seletorAberto}
          aoFechar={() => { setSeletorAberto(false) }}
          aoEscolher={(id, som) => { void compartilharFonte(id, som) }}
        />
      )}
    </section>
  )
}
