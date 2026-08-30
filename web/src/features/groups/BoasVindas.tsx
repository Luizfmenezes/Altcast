import type { ReactNode } from 'react'
import { Compass, Plus } from 'lucide-react'
import { CriarGrupo } from './CriarGrupo.js'
import { Botao } from '../../ui/Botao.js'

/**
 * O que aparece para quem entrou e nao participa de grupo nenhum.
 *
 * Este estado nao existia enquanto o cadastro era fechado: toda conta nascia
 * dentro do grupo do convite que a criou. Com o cadastro aberto ele passou a
 * ser o PRIMEIRO que muita gente ve, e um shell vazio com barras cinzas seria
 * uma porta que nao diz para onde ir.
 */
export function BoasVindas(): ReactNode {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-2xl border
                   border-border-subtle bg-bg-raised text-fg-muted"
      >
        <Compass strokeWidth={1.25} className="size-8" />
      </span>

      <div className="max-w-sm">
        <h1 className="text-xl font-semibold text-fg">Voce ainda nao tem grupos</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Um grupo e onde as conversas acontecem — canais de texto, chamadas de
          voz e as pessoas que voce convidar. Crie o seu ou entre por um convite
          que alguem tenha mandado.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <CriarGrupo
          gatilho={
            <Botao tamanho="lg">
              <Plus aria-hidden="true" />
              Criar meu primeiro grupo
            </Botao>
          }
        />
        <p className="text-xs text-fg-muted">
          Tem um convite? Abra o link que voce recebeu — ele leva direto para dentro.
        </p>
      </div>
    </main>
  )
}
