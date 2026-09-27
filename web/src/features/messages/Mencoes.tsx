import type { ReactNode } from 'react'
import { Avatar } from '../../ui/Avatar.js'
import { cn } from '../../lib/utils.js'
import type { Membro } from '../../lib/tipos.js'

/**
 * O autocompletar de mencao, como listbox de verdade.
 *
 * A versao anterior era uma fileira de botoes ANTES do campo no DOM: so se
 * chegava nela com Shift+Tab, a partir do campo, e Enter no campo mandava o
 * `@An` cru em vez de completar. O padrao agora e o de combobox da ARIA: o
 * foco nunca sai do textarea, as setas movem o item ativo e o leitor de tela
 * acompanha por `aria-activedescendant`.
 *
 * A lista vem DEPOIS do campo no DOM — e a ordem de leitura certa, porque ela
 * existe por causa do que foi digitado — e e desenhada ACIMA dele por CSS,
 * que e onde o olho de quem digita no pe da tela a procura.
 */
export function Mencoes({ id, candidatos, ativo, aoEscolher, aoApontar }: {
  id: string
  candidatos: Membro[]
  ativo: number
  aoEscolher: (membro: Membro) => void
  aoApontar: (indice: number) => void
}): ReactNode {
  if (candidatos.length === 0) return null

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Mencionar alguém"
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-md
                 border border-border bg-bg-raised p-1 shadow-popover"
    >
      {candidatos.map((m, i) => (
        <li
          key={m.userId}
          id={idDaOpcao(id, i)}
          role="option"
          aria-selected={i === ativo}
          // `mousedown` so segura o foco no textarea — sem isto o clique o
          // tiraria antes de completar. Quem completa e o clique.
          onMouseDown={evento => { evento.preventDefault() }}
          onClick={() => { aoEscolher(m) }}
          onMouseEnter={() => { aoApontar(i) }}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-fg',
            i === ativo && 'bg-bg-hover',
          )}
        >
          <Avatar nome={m.displayName} url={m.avatarUrl} className="size-6" />
          <span className="truncate font-medium">{m.displayName}</span>
        </li>
      ))}
    </ul>
  )
}

export const idDaOpcao = (lista: string, indice: number): string => `${lista}-opcao-${String(indice)}`

/** Minusculas e sem acento: quem digita "@jo" espera achar "João". */
export function dobrar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Quem pode ser mencionado a partir do trecho digitado.
 *
 * So membros do grupo DO CANAL. A lista anterior usava `members` inteiro — as
 * pessoas de todos os grupos da conta —, e oferecia mencionar quem nem estava
 * ali; o servidor descartava a mencao em silencio, e o texto saia com um `@`
 * que nao chamava ninguem.
 *
 * O casamento vale para o inicio do nome e para o inicio de qualquer palavra
 * dele: "@silva" acha "Ana Silva". O inicio do nome vem primeiro na ordem.
 */
export function candidatosDeMencao(
  membros: readonly Membro[], groupId: string, trecho: string, eu: string | null,
  limite = 8,
): Membro[] {
  const alvo = dobrar(trecho)
  const vistos = new Set<string>()
  const noInicio: Membro[] = []
  const noMeio: Membro[] = []
  for (const m of membros) {
    if (m.groupId !== groupId || m.userId === eu || vistos.has(m.userId)) continue
    vistos.add(m.userId)
    const nome = dobrar(m.displayName)
    if (nome.startsWith(alvo)) noInicio.push(m)
    else if (nome.split(/\s+/).some(p => p.startsWith(alvo))) noMeio.push(m)
  }
  const porNome = (a: Membro, b: Membro): number =>
    a.displayName.localeCompare(b.displayName, 'pt-BR')
  return [...noInicio.sort(porNome), ...noMeio.sort(porNome)].slice(0, limite)
}
