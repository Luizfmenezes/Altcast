import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Faixa } from '../../lib/midia.js'

/**
 * Uma faixa remota ligada a um elemento de midia.
 *
 * `attach`/`detach` sao do LiveKit, mas a razao de existir deste componente e
 * do React: o elemento precisa existir no DOM antes de receber a faixa, e
 * precisa solta-la no desmonte. Sem o `detach`, trocar de canal deixaria o
 * audio da sala anterior tocando sem nenhum quadrado na tela para explica-lo.
 */
export function FaixaDeMidia({ faixa, rotulo }: {
  faixa: Faixa
  rotulo: string
}): ReactNode {
  const elemento = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  useEffect(() => {
    const alvo = elemento.current
    if (alvo === null) return
    faixa.track.attach(alvo)
    return () => {
      faixa.track.detach(alvo)
    }
  }, [faixa.track])

  if (faixa.papel === 'audio' || faixa.papel === 'audio-tela') {
    // O audio nao tem o que mostrar, mas precisa estar no DOM para tocar.
    // `aria-hidden` porque um leitor de tela anunciando "reprodutor de audio"
    // para cada pessoa da sala seria ruido, nao informacao.
    return <audio ref={elemento} autoPlay aria-hidden="true" />
  }

  return (
    <figure className="overflow-hidden rounded border border-border bg-bg-raised">
      <video
        ref={elemento}
        autoPlay
        playsInline
        // O video proprio e sempre mudo: reproduzir o proprio audio e eco. O
        // alheio tambem, porque o som dele chega pela faixa de audio separada.
        muted
        // A camera propria se ve espelhada, como num espelho — e o que o olho
        // espera. A tela compartilhada nao: espelhar texto o tornaria ilegivel.
        className={`aspect-video w-full bg-black object-cover ${
          faixa.local && faixa.papel === 'camera' ? '-scale-x-100' : ''}`}
      />
      <figcaption className="truncate px-2 py-1 text-xs text-fg-muted">
        {faixa.papel === 'tela' ? `${rotulo} — tela` : rotulo}
      </figcaption>
    </figure>
  )
}
