import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Maximize2, Minimize2, PictureInPicture2, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { Faixa, QualidadeDeRecepcao } from '../../lib/midia.js'

/**
 * Uma faixa remota ligada a um elemento de midia.
 *
 * `attach`/`detach` sao do LiveKit, mas a razao de existir deste componente e
 * do React: o elemento precisa existir no DOM antes de receber a faixa, e
 * precisa solta-la no desmonte. Sem o `detach`, trocar de canal deixaria o
 * audio da sala anterior tocando sem nenhum quadrado na tela para explica-lo.
 */
/**
 * O tamanho de uma faixa na tela, e o que ele muda alem de pixels.
 *
 * `miniatura` NAO e "a mesma coisa, menor": ela nao mostra controle nenhum.
 * Num quadro de 160px, o cursor de volume e os botoes de canto ficariam abaixo
 * do alvo minimo de toque — e, pior, empilhariam controles clicaveis dentro de
 * um item que ja e clicavel por inteiro para escolher o palco.
 */
export type TamanhoDaFaixa = 'palco' | 'miniatura'

export function FaixaDeMidia({
  faixa, rotulo, volume, aoMudarVolume, tamanho = 'palco', qualidade, aoMudarQualidade,
}: {
  faixa: Faixa
  rotulo: string
  /**
   * O volume da fonte de som que acompanha ESTE video, de 0 a 1.
   *
   * `undefined` quando nao ha o que controlar — a propria camera, ou uma tela
   * compartilhada sem som. A ausencia esconde o controle em vez de mostrar um
   * cursor que nao move nada.
   */
  volume?: number
  aoMudarVolume?: (v: number) => void
  tamanho?: TamanhoDaFaixa
  /**
   * A qualidade que EU recebo desta transmissao. `undefined` na propria faixa:
   * nao ha o que negociar com o proprio navegador.
   */
  qualidade?: QualidadeDeRecepcao
  aoMudarQualidade?: (nivel: QualidadeDeRecepcao) => void
}): ReactNode {
  const elemento = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const moldura = useRef<HTMLElement>(null)
  const [cheia, setCheia] = useState(false)
  const [flutuando, setFlutuando] = useState(false)

  useEffect(() => {
    const alvo = elemento.current
    if (alvo === null) return
    faixa.track.attach(alvo)
    return () => {
      faixa.track.detach(alvo)
    }
  }, [faixa.track])

  /**
   * Quem manda no estado e o navegador, nao o clique.
   *
   * Sair da tela cheia pelo Esc, ou fechar o mini player pelo X da janelinha,
   * nao passa por handler nenhum: sem estes ouvintes o botao continuaria
   * dizendo "sair da tela cheia" com a pagina ja restaurada.
   */
  useEffect(() => {
    const alvo = elemento.current
    const quadro = moldura.current
    if (alvo === null || quadro === null) return

    const trocouCheia = (): void => {
      setCheia(document.fullscreenElement === quadro)
    }
    const entrouPip = (): void => { setFlutuando(true) }
    const saiuPip = (): void => { setFlutuando(false) }

    document.addEventListener('fullscreenchange', trocouCheia)
    alvo.addEventListener('enterpictureinpicture', entrouPip)
    alvo.addEventListener('leavepictureinpicture', saiuPip)
    return () => {
      document.removeEventListener('fullscreenchange', trocouCheia)
      alvo.removeEventListener('enterpictureinpicture', entrouPip)
      alvo.removeEventListener('leavepictureinpicture', saiuPip)
    }
  }, [])

  const alternarCheia = useCallback((): void => {
    const quadro = moldura.current
    if (quadro === null) return
    // Tela cheia na MOLDURA, e nao no video: assim os controles proprios —
    // volume, mini player, o nome de quem transmite — continuam alcancaveis
    // com a transmissao ocupando o monitor inteiro.
    if (document.fullscreenElement === quadro) void document.exitFullscreen()
    else void quadro.requestFullscreen().catch(() => undefined)
  }, [])

  const alternarFlutuante = useCallback((): void => {
    const alvo = elemento.current
    if (alvo === null) return
    // O mini player e uma janela do NAVEGADOR, e nao um retangulo da pagina: e
    // isso que a deixa por cima do editor, do jogo ou do que mais estiver
    // aberto, do mesmo jeito que o mini player de musica faz.
    if (document.pictureInPictureElement === alvo) void document.exitPictureInPicture()
    else void alvo.requestPictureInPicture().catch(() => undefined)
  }, [])

  if (faixa.papel === 'audio' || faixa.papel === 'audio-tela') {
    // O audio nao tem o que mostrar, mas precisa estar no DOM para tocar.
    // `aria-hidden` porque um leitor de tela anunciando "reprodutor de audio"
    // para cada pessoa da sala seria ruido, nao informacao.
    return <audio ref={elemento} autoPlay aria-hidden="true" />
  }

  const ehTela = faixa.papel === 'tela'
  const legenda = ehTela ? `${rotulo} — tela` : rotulo
  const pequena = tamanho === 'miniatura'
  // Consultado no render, e nao no modulo, porque o suporte depende do
  // navegador E do contexto: um iframe sem `allow="fullscreen"` desliga a tela
  // cheia numa pagina que a suporta.
  const temCheia = document.fullscreenEnabled === true && !pequena
  // A propria transmissao nao vai para o mini player: quem compartilha ja ve a
  // propria tela em tamanho natural, atras da aba.
  const temPip = document.pictureInPictureEnabled === true && !faixa.local && !pequena

  return (
    <figure
      ref={moldura}
      className={`group relative overflow-hidden border border-border bg-bg-raised ${
        cheia ? 'flex h-full w-full items-center justify-center rounded-none bg-black' : 'rounded'}`}
    >
      <video
        ref={elemento}
        autoPlay
        playsInline
        // O video proprio e sempre mudo: reproduzir o proprio audio e eco. O
        // alheio tambem, porque o som dele chega pela faixa de audio separada.
        muted
        // A camera propria se ve espelhada, como num espelho — e o que o olho
        // espera. A tela compartilhada nao: espelhar texto o tornaria ilegivel.
        //
        // `object-contain` na tela pela mesma familia de razoes: cortar as
        // bordas de um monitor 16:10 para encaixar num quadro 16:9 come
        // justamente a barra de tarefas e a linha do rodape.
        className={`w-full bg-black ${cheia ? 'h-full' : 'aspect-video'} ${
          ehTela || cheia ? 'object-contain' : 'object-cover'} ${
          faixa.local && faixa.papel === 'camera' ? '-scale-x-100' : ''}`}
      />

      {/*
        Numa miniatura nao ha controle nenhum: o quadro inteiro pertence ao
        botao que escolhe o palco, e um botao dentro de outro alvo clicavel e
        uma armadilha tanto para o ponteiro quanto para o teclado.
      */}
      {pequena ? null : (
      <>
      {/*
        Os controles ficam por cima do video e so aparecem no foco ou no
        ponteiro. Sempre visiveis, tapariam o canto da tela compartilhada — que
        e onde o menu do sistema de quem transmite costuma estar.

        `focus-within` nao e enfeite: sem ele quem navega por teclado moveria o
        foco para um botao invisivel. E `hover:none` cobre o toque, onde nao
        existe "passar o mouse": num celular os controles ficam sempre a vista,
        porque a alternativa seria um botao invisivel e clicavel.
      */}
      <div
        className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 p-1
                   opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100
                   [@media(hover:none)]:opacity-100"
      >
        {volume !== undefined && aoMudarVolume !== undefined && (
          <ControleDeVolume rotulo={legenda} volume={volume} aoMudar={aoMudarVolume} />
        )}

        {qualidade !== undefined && aoMudarQualidade !== undefined && (
          <EscolhaDeRecepcao
            rotulo={legenda}
            valor={qualidade}
            aoMudar={aoMudarQualidade}
          />
        )}

        {temPip && (
          <BotaoDaFaixa
            rotulo={flutuando ? `Fechar o mini player de ${legenda}` : `Mini player de ${legenda}`}
            aoClicar={alternarFlutuante}
            pressionado={flutuando}
          >
            <PictureInPicture2 aria-hidden="true" className="size-4" />
          </BotaoDaFaixa>
        )}

        {temCheia && (
          <BotaoDaFaixa
            rotulo={cheia ? `Sair da tela cheia de ${legenda}` : `Tela cheia de ${legenda}`}
            aoClicar={alternarCheia}
            pressionado={cheia}
          >
            {cheia
              ? <Minimize2 aria-hidden="true" className="size-4" />
              : <Maximize2 aria-hidden="true" className="size-4" />}
          </BotaoDaFaixa>
        )}
      </div>
      </>
      )}

      <figcaption
        className={`truncate px-2 py-1 ${pequena ? 'text-[11px]' : 'text-xs'} ${
          cheia ? 'absolute bottom-0 left-0 bg-black/70 text-white' : 'text-fg-muted'}`}
      >
        {legenda}
      </figcaption>
    </figure>
  )
}

/**
 * Onde o controle esta desenhado.
 *
 * `video` e sobre a tarja preta em cima da transmissao, onde o unico contraste
 * garantido e o branco; `lista` e sobre o fundo do painel, onde a cor precisa
 * vir dos tokens do tema para sobreviver ao modo claro.
 */
type Tom = 'video' | 'lista'

const TONS: Record<Tom, string> = {
  video: 'text-white hover:bg-white/20 focus-visible:bg-white/20',
  lista: 'text-fg-muted hover:bg-bg-hover focus-visible:bg-bg-hover',
}

/** Um botao de canto de video: alvo de 32px, sem texto, rotulo no acessivel. */
function BotaoDaFaixa({ rotulo, aoClicar, pressionado, tom = 'video', children }: {
  rotulo: string
  aoClicar: () => void
  pressionado: boolean
  tom?: Tom
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={rotulo}
      aria-pressed={pressionado}
      title={rotulo}
      className={`inline-flex size-8 items-center justify-center rounded ${TONS[tom]}`}
    >
      {children}
    </button>
  )
}

/**
 * A qualidade que quem ASSISTE escolhe, faixa a faixa.
 *
 * O que ela conserta e uma assimetria: ate agora so quem publicava tinha
 * escolha, e a unica saida para "travou pra mim" era pedir a quem transmite
 * que piorasse a transmissao para a sala inteira. O YouTube resolveu isso ha
 * quinze anos com um menu, e e um menu que resolve aqui tambem.
 *
 * Um `select` de verdade, e nao botoes: sao quatro opcoes mutuamente
 * exclusivas com um padrao obvio, que e exatamente o caso em que o controle
 * nativo ja e acessivel por teclado, por toque e por leitor de tela sem
 * precisarmos reimplementar nada.
 */
const NIVEIS: Record<QualidadeDeRecepcao, string> = {
  automatica: 'Automatica',
  alta: 'Alta',
  media: 'Media',
  baixa: 'Baixa',
}

function EscolhaDeRecepcao({ rotulo, valor, aoMudar }: {
  rotulo: string
  valor: QualidadeDeRecepcao
  aoMudar: (nivel: QualidadeDeRecepcao) => void
}): ReactNode {
  return (
    <select
      value={valor}
      aria-label={`Qualidade recebida de ${rotulo}`}
      onChange={e => { aoMudar(e.target.value as QualidadeDeRecepcao) }}
      className="h-8 rounded bg-black/40 px-1 text-xs text-white"
    >
      {(Object.keys(NIVEIS) as QualidadeDeRecepcao[]).map(nivel => (
        <option key={nivel} value={nivel} className="text-fg">{NIVEIS[nivel]}</option>
      ))}
    </select>
  )
}

/**
 * O volume de UMA fonte de som remota.
 *
 * Um `range` de verdade, e nao um par de setas, porque o ajuste util aqui e
 * continuo: a queixa que ele resolve — "essa transmissao esta alta demais
 * perto das outras" — e sobre equilibrio entre fontes, nao sobre ligar e
 * desligar. O botao ao lado cobre o caso extremo de silenciar de uma vez.
 */
export function ControleDeVolume({ rotulo, volume, aoMudar, tom = 'video' }: {
  rotulo: string
  volume: number
  aoMudar: (v: number) => void
  tom?: Tom
}): ReactNode {
  /** O volume a restaurar quando o mudo for desfeito. Nunca zero. */
  const anterior = useRef(1)
  const mudo = volume === 0
  const Icone = mudo ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <>
      <BotaoDaFaixa
        rotulo={mudo ? `Reativar o som de ${rotulo}` : `Silenciar ${rotulo}`}
        pressionado={mudo}
        tom={tom}
        aoClicar={() => {
          if (mudo) aoMudar(anterior.current)
          else {
            anterior.current = volume
            aoMudar(0)
          }
        }}
      >
        <Icone aria-hidden="true" className="size-4" />
      </BotaoDaFaixa>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        aria-label={`Volume de ${rotulo}`}
        onChange={e => { aoMudar(Number(e.target.value) / 100) }}
        className="h-8 w-20 accent-accent"
      />
    </>
  )
}
