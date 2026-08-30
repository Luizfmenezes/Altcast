import type { ReactNode } from 'react'
import { Botao } from '../../ui/Botao.js'
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
export function ConfiguracoesGrupo({ groupId, aoFechar }: {
  groupId: string
  aoFechar: () => void
}): ReactNode {
  return (
    <section aria-label="Configuracoes do grupo" className="flex flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-fg">Configuracoes do grupo</h1>
        <Botao variante="discreto" onClick={aoFechar}>Fechar</Botao>
      </header>

      <GestaoDeCanais groupId={groupId} />

      <Separador />
      <Convidar groupId={groupId} />

      <Separador />
      <Membros groupId={groupId} />
    </section>
  )
}
