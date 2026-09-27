import { PERMISSOES_DE_ADMIN, PERMISSOES_DE_TODOS } from '../permissions/acoes.js'
import { newId } from '../shared/ids.js'
import type { roles } from '../db/schema.js'

/**
 * Os cargos com que todo grupo nasce.
 *
 * Existe porque passaram a ser TRES os caminhos que criam um grupo — a rota
 * `POST /api/groups`, a migracao 0013 que semeou os grupos ja existentes, e o
 * `seed-owner` que cria o primeiro grupo de uma instalacao — e os tres
 * precisam produzir exatamente a mesma coisa.
 *
 * Nao e zelo preventivo: o `seed-owner` JA divergia. Ele inseria grupo, membro
 * e canal direto no banco e nao criava cargo nenhum, entao o grupo inicial de
 * toda instalacao nova nascia sem o cargo de todos — caindo no fallback de
 * `loadGroupActor`, que resolve permissao pelo papel antigo. Funcionava por
 * acidente, e teria parado de funcionar no dia em que alguem abrisse a tela de
 * cargos daquele grupo e encontrasse uma lista vazia sem entender por que.
 *
 * A migracao continua com os literais escritos a mao, e isso e proposital: ela
 * e um retrato do que valia no dia em que rodou, e nao pode mudar de sentido
 * porque `acoes.ts` mudou depois.
 */
export function cargosPadrao(groupId: string): (typeof roles.$inferInsert)[] {
  return [
    {
      id: newId(), groupId, name: 'todos', color: null, position: 0,
      permissions: [...PERMISSOES_DE_TODOS], isDefault: true,
    },
    {
      id: newId(), groupId, name: 'Administrador', color: '#9c96f8', position: 10,
      permissions: [...PERMISSOES_DE_ADMIN], isDefault: false,
    },
  ]
}
