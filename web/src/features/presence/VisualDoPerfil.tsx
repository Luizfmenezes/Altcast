import type { ReactNode } from 'react'
import { Avatar, corDe } from '../../ui/Avatar.js'
import { cn } from '../../lib/utils.js'

/**
 * O topo de um perfil: banner, foto sobreposta, nome, pronomes e "sobre mim".
 *
 * Um componente so para o cartao que os outros abrem e para a previa da tela
 * de edicao. Se fossem dois, a previa mentiria no primeiro ajuste de um deles
 * — e a previa so vale alguma coisa se for exatamente o que os outros veem.
 */

export type DadosDoVisual = {
  displayName: string
  username?: string | null
  avatarUrl: string | null
  bio?: string | null
  pronouns?: string | null
  bannerColor?: string | null
  bannerUrl?: string | null
}

/**
 * A cor do banner de quem nunca escolheu uma: a mesma do avatar sem foto.
 *
 * E o que o Discord faz com a cor dominante da foto, sem precisar ler pixel
 * nenhum: o cartao nunca aparece com um topo cinza de "nao configurado".
 */
export function corDoBanner(dados: Pick<DadosDoVisual, 'bannerColor' | 'displayName'>): string {
  return dados.bannerColor ?? corDe(dados.displayName)
}

export function VisualDoPerfil({ dados, cracha, cor, extra, titulo }: {
  dados: DadosDoVisual
  /** O ponto de presenca sobre a foto. */
  cracha?: ReactNode
  /** A cor do nome, quando um cargo a define. */
  cor?: string | null
  /** O que vem abaixo do "sobre mim": status, grupos em comum. */
  extra?: ReactNode
  /** O elemento do nome; o dialogo passa o proprio `Title`. */
  titulo?: (nome: ReactNode) => ReactNode
}): ReactNode {
  const nome = (
    <span className="block truncate" style={cor ? { color: cor } : undefined}>
      {dados.displayName}
    </span>
  )
  const temBio = (dados.bio ?? '') !== ''

  return (
    <div className="flex flex-col">
      <div
        aria-hidden="true"
        className="h-24 w-full bg-cover bg-center"
        style={{
          backgroundColor: corDoBanner(dados),
          ...(dados.bannerUrl ? { backgroundImage: `url("${dados.bannerUrl}")` } : {}),
        }}
      />
      <div className="relative px-4">
        {/* A foto invade o banner, com uma borda da cor do cartao — o recorte
            que faz a foto parecer apoiada no banner, e nao colada nele. */}
        <span className="relative -mt-10 inline-flex rounded-full border-[5px] border-bg-raised bg-bg-raised">
          <Avatar
            nome={dados.displayName}
            url={dados.avatarUrl}
            tamanho="xl"
            className="size-[72px] text-[26px]"
          />
          {cracha}
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight text-fg">
            {titulo ? titulo(nome) : nome}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-fg-muted">
            {(dados.username ?? '') !== '' && <span>@{dados.username}</span>}
            {(dados.username ?? '') !== '' && (dados.pronouns ?? '') !== '' && (
              <span aria-hidden="true">·</span>
            )}
            {(dados.pronouns ?? '') !== '' && <span>{dados.pronouns}</span>}
          </p>
        </div>

        {temBio && (
          <section className={cn('rounded-md bg-bg-sunken px-3 py-2')}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Sobre mim
            </h3>
            <p className="whitespace-pre-line break-words text-sm text-fg">{dados.bio}</p>
          </section>
        )}

        {extra}
      </div>
    </div>
  )
}
