import type { ReactNode } from 'react'
import { Separador } from '../../ui/Separador.js'
import { GestaoDeCanais } from './GestaoDeCanais.js'
import { Convidar } from '../groups/Convidar.js'
import { Membros } from '../groups/Membros.js'

/**
 * Configuracoes do grupo.
 *
 * Tres assuntos, um por secao: canais, convites e pessoas.
 *
 * A gestao de canais carrega a unica excecao a regra de invisibilidade: quem
 * administra ve os NOMES dos canais privados, porque precisa poder apagar um
 * canal orfao. Ela diz isso em voz alta, com um rotulo em cada linha
 * inacessivel — sem o rotulo, a lista sugeriria um acesso que nao existe, e o
 * primeiro clique frustrado ensinaria a regra da pior maneira.
 *
 * Convites e membros vivem em componentes proprios, em features/groups: eles
 * tambem sao alcancados pelo menu do grupo, e duplicar a tela seria manter
 * duas versoes da mesma coisa envelhecendo separadas.
 */
export function ConfiguracoesGrupo({ groupId }: { groupId: string }): ReactNode {
  return (
    // Sem botao de fechar proprio: o dialogo que a contem ja tem um, e dois
    // controles de fechar na mesma tela so criam duvida sobre qual fecha o que.
    <section aria-label="Configuracoes do grupo" className="flex flex-col gap-6 p-4">
      <GestaoDeCanais groupId={groupId} />

      <Separador />
      <Convidar groupId={groupId} />

      <Separador />
      <Membros groupId={groupId} />
    </section>
  )
}
