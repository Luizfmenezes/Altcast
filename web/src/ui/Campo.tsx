import { useId } from 'react'
import type { ReactNode } from 'react'

/**
 * Campo de formulario com rotulo persistente.
 *
 * O rotulo e um <label> de verdade, sempre visivel: `placeholder` some ao
 * digitar e deixa quem voltou ao formulario sem saber o que o campo pedia
 * (SC 3.3.2). O erro entra como texto associado por aria-describedby — borda
 * vermelha sozinha nao existe para quem nao distingue vermelho (SC 1.4.1).
 */
export function Campo(props: {
  rotulo: string
  tipo?: 'text' | 'email' | 'password'
  valor: string
  aoMudar: (v: string) => void
  erro?: string | undefined
  dica?: string | undefined
  autoComplete?: string
  referencia?: React.Ref<HTMLInputElement>
  obrigatorio?: boolean
}): ReactNode {
  const id = useId()
  const idErro = `${id}-erro`
  const idDica = `${id}-dica`
  const descrito = [props.erro ? idErro : null, props.dica ? idDica : null]
    .filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {props.rotulo}
      </label>
      <input
        id={id}
        ref={props.referencia}
        type={props.tipo ?? 'text'}
        value={props.valor}
        onChange={e => props.aoMudar(e.target.value)}
        {...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete })}
        required={props.obrigatorio ?? false}
        aria-invalid={props.erro ? true : undefined}
        aria-describedby={descrito === '' ? undefined : descrito}
        className="h-9 rounded border border-border bg-bg px-3 text-fg
                   placeholder:text-fg-muted focus:border-accent"
      />
      {props.dica && (
        <p id={idDica} className="text-xs text-fg-muted">{props.dica}</p>
      )}
      {props.erro && (
        <p id={idErro} className="text-xs text-danger">{props.erro}</p>
      )}
    </div>
  )
}
