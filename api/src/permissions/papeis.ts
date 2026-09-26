import { PERMISSOES_DE_ADMIN, PERMISSOES_DE_TODOS, type Action } from './acoes.js'
import type { Actor } from './can.js'

/**
 * A ponte entre o papel de antes e o conjunto de permissoes de agora.
 *
 * `group_members.role` NAO morreu com os cargos, e nao deve morrer: ele
 * continua sendo a verdade sobre quem e o dono — a invariante de um unico
 * owner por grupo vive num indice unico parcial do banco, e nenhuma tabela de
 * cargos substitui isso.
 *
 * O que ele deixou de ser e a fonte das PERMISSOES. Esta funcao existe para
 * dois usos, e nenhum deles e o caminho normal:
 *
 * 1. a matriz de `can.test.ts`, que precisava continuar valendo celula por
 *    celula depois da troca — e por isso o teste de equivalencia usa isto;
 * 2. o grupo que, por qualquer razao, ficou sem o cargo padrao. Em vez de
 *    devolver conjunto vazio e trancar todo mundo para fora de um grupo que
 *    funcionava, ele volta a se comportar como antes dos cargos.
 */
export const POSICAO_PADRAO = { member: 0, admin: 1, owner: 2 } as const

export function permissoesDoPapel(papel: 'owner' | 'admin' | 'member'): Set<Action> {
  // O dono recebe as de admin, e nao "todas": o que o torna dono e o
  // `ehDono` do ator, que atravessa a concessao. Dar tudo aqui tambem
  // esconderia um erro de resolucao atras do privilegio dele.
  return new Set(papel === 'member' ? PERMISSOES_DE_TODOS : PERMISSOES_DE_ADMIN)
}

export function atorDePapel(
  userId: string,
  papel: 'owner' | 'admin' | 'member' | null,
  inChannel = false,
): Actor {
  if (papel === null) {
    return { userId, permissoes: null, ehDono: false, inChannel, topo: 0, papel: null }
  }
  return {
    userId,
    permissoes: permissoesDoPapel(papel),
    ehDono: papel === 'owner',
    inChannel,
    topo: POSICAO_PADRAO[papel],
    papel,
  }
}
