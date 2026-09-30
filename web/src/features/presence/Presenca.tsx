import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import type { StatusDePresenca } from '../../lib/tipos.js'

/** A palavra de cada estado, a mesma na tela e no leitor de tela. */
export const ROTULO_DE_PRESENCA: Record<StatusDePresenca, string> = {
  online: 'online',
  idle: 'ausente',
  dnd: 'não perturbe',
  offline: 'offline',
  invisible: 'invisível',
}

/** Esta pessoa esta aqui agora (online, ausente ou nao perturbe)? */
export const estaPresente = (s: StatusDePresenca): boolean =>
  s === 'online' || s === 'idle' || s === 'dnd'

/**
 * O estado de presenca de alguem.
 *
 * Nunca so pela cor, e agora com cinco estados cada um tem uma FORMA:
 *
 * - online: ponto cheio, no verde de presenca;
 * - ausente: lua (o ponto com uma mordida), no amarelo de aviso;
 * - nao perturbe: disco com um traco — "pare" pela forma, sem tomar o
 *   vermelho, que no sistema significa erro;
 * - offline e invisivel: ponto vazado.
 *
 * O `data-presenca` e o contrato que o teste verifica: "a forma distingue"
 * nao pode ser desfeito por engano num ajuste de estilo.
 *
 * Dois modos, mesma verdade: `texto` escreve a palavra ao lado; `cracha`
 * encaixa o ponto no canto de um avatar e manda a palavra ao leitor de tela.
 */
export function Presenca({ status, modo = 'texto' }: {
  status: StatusDePresenca
  /** `texto-oculto` e so o simbolo, para listas que ja escrevem a palavra ao lado. */
  modo?: 'texto' | 'cracha' | 'texto-oculto'
}): ReactNode {
  const forma = status === 'online' ? 'cheio'
    : status === 'idle' ? 'lua'
      : status === 'dnd' ? 'traco'
        : 'vazado'

  const tamanho = modo === 'cracha' ? 'size-2.5' : 'size-2'
  const ponto = (
    <span
      aria-hidden="true"
      data-presenca={forma}
      className={cn(
        'relative inline-flex items-center justify-center overflow-hidden rounded-full border',
        tamanho,
        forma === 'cheio' && 'border-presence-online bg-presence-online',
        forma === 'lua' && 'border-warning bg-warning',
        forma === 'traco' && 'border-fg bg-fg',
        forma === 'vazado' && 'border-fg-muted bg-transparent',
        // O anel na cor do fundo recorta o ponto para fora do avatar, em vez
        // de pousar em cima dele: sem isso, um avatar escuro engole o vazado.
        modo === 'cracha' && 'border-2 ring-2 ring-bg-raised',
      )}
    >
      {forma === 'lua' && (
        <span className="absolute -left-px -top-px size-[60%] rounded-full bg-bg-raised" />
      )}
      {forma === 'traco' && <span className="h-px w-[60%] bg-bg-raised" />}
    </span>
  )

  if (modo === 'texto-oculto') return ponto

  if (modo === 'cracha') {
    return (
      <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex">
        {ponto}
        <span className="sr-only">{ROTULO_DE_PRESENCA[status]}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {ponto}
      <span className="text-xs text-fg-muted">{ROTULO_DE_PRESENCA[status]}</span>
    </span>
  )
}
