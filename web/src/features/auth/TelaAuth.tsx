import type { ReactNode } from 'react'
import { Login } from './Login.js'
import { Cadastro } from './Cadastro.js'
import { PreviaConvite } from './PreviaConvite.js'
import { EsqueciASenha } from './EsqueciASenha.js'
import { RedefinirSenha } from './RedefinirSenha.js'
import { VerificarEmail } from './VerificarEmail.js'
import { Porta } from './PalcoMercurio.js'
import { usarRota } from '../../lib/rota.js'
import type { Usuario } from '../../lib/tipos.js'

/**
 * A porta de entrada.
 *
 * Todas as telas de fora da sessao moram no mesmo palco: entrar, criar conta,
 * recuperar senha, redefinir, confirmar e-mail e a previa de um convite. Qual
 * delas aparece e decidido pela URL, e nao por estado interno — porque tres
 * dessas chegam por um link de e-mail e precisam existir como endereco.
 */
export function TelaAuth({ aoEntrar }: {
  aoEntrar: (u: Usuario) => void
}): ReactNode {
  const rota = usarRota()

  return (
    <Porta>
      {rota.nome === 'convite' && (
        <>
          <PreviaConvite codigo={rota.codigo} />
          <Cadastro codigo={rota.codigo} aoEntrar={aoEntrar} />
        </>
      )}

      {rota.nome === 'criar-conta' && <Cadastro aoEntrar={aoEntrar} />}
      {rota.nome === 'esqueci-a-senha' && <EsqueciASenha />}
      {rota.nome === 'redefinir' && <RedefinirSenha token={rota.token} />}
      {rota.nome === 'verificar' && <VerificarEmail token={rota.token} />}
      {rota.nome === 'entrar' && <Login aoEntrar={aoEntrar} />}
    </Porta>
  )
}
