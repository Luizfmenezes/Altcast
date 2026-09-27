import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { corDoMembro, useStore } from '../../lib/store.js'
import { usePerfilAberto } from './perfilAberto.js'
import { cn } from '../../lib/utils.js'
import { Avatar } from '../../ui/Avatar.js'
import { Contador } from '../../ui/bits/Contador.js'
import { Presenca } from './Presenca.js'
import type { Membro } from '../../lib/tipos.js'

const PESO_DO_PAPEL = { owner: 0, admin: 1, member: 2 } as const

/**
 * As secoes, na ordem em que aparecem.
 *
 * Papel separa quem esta online; quem esta offline vai todo para o fim, sem
 * distincao de cargo. A razao e o uso: numa conversa, "quem posso chamar
 * agora" e a pergunta, e saber que o dono do grupo esta offline nao o torna
 * mais alcancavel do que qualquer outro ausente.
 */
const SECOES = [
  { chave: 'owner', titulo: 'Dono' },
  { chave: 'admin', titulo: 'Administradores' },
  { chave: 'member', titulo: 'Membros' },
  { chave: 'offline', titulo: 'Offline' },
] as const

type Chave = (typeof SECOES)[number]['chave']

function agrupar(membros: Membro[]): Map<Chave, Membro[]> {
  const grupos = new Map<Chave, Membro[]>(SECOES.map(s => [s.chave, []]))
  for (const m of membros) {
    grupos.get(m.status === 'online' ? m.role : 'offline')?.push(m)
  }
  return grupos
}

function LinhaDeMembro({ membro }: { membro: Membro }): ReactNode {
  const abrirPerfil = usePerfilAberto(e => e.abrirPerfil)
  const cor = useStore(e => corDoMembro(e, membro.groupId, membro.userId))
  return (
    <li>
      {/*
        Um botao: clicar na pessoa abre o cartao dela. A linha era so texto, e
        "quem e essa pessoa, de onde a conheco" nao tinha resposta na tela.
      */}
      <button
        type="button"
        onClick={() => { abrirPerfil(membro.userId) }}
        // Nome e estado num unico rotulo: 'Ana, online' e uma frase; nome e
        // estado separados obrigariam quem ouve a costurar os dois.
        aria-label={`${membro.displayName}, ${membro.status}`}
        className={cn(
          'group/membro flex w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
          'hover:bg-bg-hover focus-visible:bg-bg-hover',
          // Quem esta offline fica presente mas recuado. Sumir com a pessoa
          // esconderia a informacao de que ela existe no grupo; deixa-la com o
          // mesmo peso faria trinta ausentes competirem com tres presentes.
          membro.status === 'online' ? 'text-fg' : 'text-fg-muted',
        )}
        style={{ minHeight: 'var(--height-row)' }}
      >
        <span
          className={cn(
            'relative flex shrink-0 transition-opacity',
            membro.status === 'online' ? 'opacity-100' : 'opacity-60',
          )}
        >
          <Avatar nome={membro.displayName} url={membro.avatarUrl} tamanho="sm" />
          <Presenca status={membro.status} modo="cracha" />
        </span>

        <span
          className={cn('min-w-0 flex-1 truncate', membro.status === 'online' && 'cor-de-cargo')}
          style={cor === null ? undefined : { '--cor-cargo': cor } as CSSProperties}
        >
          {membro.displayName}
        </span>
      </button>
    </li>
  )
}

/**
 * A coluna de membros.
 *
 * Reescrita por tres motivos de uma vez. O avatar ja existia no dado desde
 * sempre — `Membro.avatarUrl` chega pelo `ready` e pela rota REST, e o rail de
 * grupos e a tela de membros das configuracoes ja o desenhavam — e este era o
 * unico lugar do sistema que simplesmente nao lia o campo. O agrupamento por
 * papel e estado responde "quem posso chamar agora" de relance, em vez de
 * exigir que alguem leia trinta linhas procurando um ponto verde. E a largura
 * deixou de ser fixa: dentro do painel redimensionavel ela pertence ao painel.
 */
export function PainelMembros({ sobreposicao = false }: {
  /**
   * Em tela estreita a coluna vira uma gaveta por cima da conversa, e ai ela
   * precisa da propria largura. Dentro do painel redimensionavel, quem dita a
   * largura e o painel — declarar 240px fixos ali descolava as duas coisas:
   * arrastar a divisoria para 360px deixava 120px de fundo sem borda nem
   * superficie, e arrastar para 180px fazia a coluna transbordar, porque
   * `shrink-0` a proibia de encolher.
   */
  sobreposicao?: boolean
} = {}): ReactNode {
  const members = useStore(e => e.members)
  const grupoAtivo = useStore(e => e.grupoAtivo)

  const grupos = useMemo(() => agrupar(
    members
      .filter(m => m.groupId === grupoAtivo)
      // `toSorted` em vez de `sort`: o `filter` acima ja devolve um array novo,
      // mas depender disso e um contrato invisivel que a proxima edicao quebra.
      .toSorted((a, b) =>
        PESO_DO_PAPEL[a.role] - PESO_DO_PAPEL[b.role]
        || a.displayName.localeCompare(b.displayName)),
  ), [members, grupoAtivo])

  const online = members.filter(m => m.groupId === grupoAtivo && m.status === 'online').length

  return (
    <aside
      aria-label="Membros"
      className={cn(
        'flex min-h-0 flex-col overflow-y-auto border-l border-border-subtle bg-bg-raised',
        sobreposicao ? 'shrink-0' : 'h-full w-full',
      )}
      style={{
        padding: 'var(--space-row)',
        ...(sobreposicao ? { width: 'var(--w-members)' } : {}),
      }}
    >
      <h2 className="flex items-baseline gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Membros
        {/*
          O numero ANDA ate o valor novo em vez de saltar. Numa lista de
          presenca isso nao e enfeite: o salto de 3 para 4 e indistinguivel de
          um re-render qualquer, e a caminhada e o que faz o olho perceber que
          alguem acabou de chegar sem precisar de um aviso piscando.
        */}
        <span className="font-mono normal-case tracking-normal tabular-nums">
          <Contador para={online} /> online
        </span>
      </h2>

      {SECOES.map(({ chave, titulo }) => {
        const doGrupo = grupos.get(chave) ?? []
        if (doGrupo.length === 0) return null

        const id = `membros-${chave}`
        return (
          <section key={chave} className="flex flex-col pb-2">
            {/*
              A contagem no titulo nao e enfeite: e ela que devolve, em texto, a
              informacao que saiu de cada linha quando a palavra "offline"
              deixou de ser impressa trinta vezes.
            */}
            <h3
              id={id}
              className="px-2 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"
            >
              {titulo}
              <span className="font-mono normal-case tabular-nums"> — <Contador para={doGrupo.length} /></span>
            </h3>
            <ul aria-labelledby={id} className="flex flex-col">
              {doGrupo.map(membro => <LinhaDeMembro key={membro.userId} membro={membro} />)}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
