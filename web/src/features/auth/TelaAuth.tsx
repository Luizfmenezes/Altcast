import { useState } from 'react'
import type { ReactNode } from 'react'
import { Login, type Usuario } from './Login.js'
import { Cadastro } from './Cadastro.js'
import { PreviaConvite } from './PreviaConvite.js'
import { Botao } from '../../ui/Botao.js'

/**
 * A porta de entrada. Sem codigo de convite no contexto existe apenas o login —
 * o cadastro e fechado por convite, e mostrar um formulario que sera recusado
 * no envio seria desperdicar o tempo de quem o preencheu.
 *
 * O codigo vive no estado desta tela, e nao dentro do cadastro, para sobreviver
 * a ida e volta entre as duas abas do formulario.
 */
export function TelaAuth({ codigoInicial, aoEntrar }: {
  codigoInicial?: string
  aoEntrar: (u: Usuario) => void
}): ReactNode {
  const codigo = codigoInicial ?? null
  const [criandoConta, setCriandoConta] = useState(false)

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 p-6">
      {codigo !== null && <PreviaConvite codigo={codigo} />}

      {criandoConta && codigo !== null
        ? <Cadastro codigo={codigo} aoEntrar={aoEntrar} />
        : <Login aoEntrar={aoEntrar} />}

      {codigo !== null && (
        <Botao
          type="button" variante="discreto"
          onClick={() => setCriandoConta(!criandoConta)}
        >
          {criandoConta ? 'Ja tenho conta' : 'Criar conta'}
        </Botao>
      )}
    </main>
  )
}
