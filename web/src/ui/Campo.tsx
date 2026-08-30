import { useId } from 'react'
import type { ReactNode, Ref } from 'react'
import { cn } from '../lib/utils.js'

/**
 * Campo de formulario com rotulo persistente.
 *
 * O rotulo e um <label> de verdade, sempre visivel: `placeholder` some ao
 * digitar e deixa quem voltou ao formulario sem saber o que o campo pedia
 * (SC 3.3.2). O erro entra como texto associado por aria-describedby — borda
 * vermelha sozinha nao existe para quem nao distingue vermelho (SC 1.4.1).
 *
 * Duas aparencias, mesma semantica: `caixa` dentro do produto, onde o campo
 * precisa se separar de uma tela cheia de outras coisas, e `linha` na porta de
 * entrada, onde ele e quase a unica coisa na tela e a caixa so faria barulho.
 */
export function Campo(props: {
  rotulo: string
  tipo?: 'text' | 'email' | 'password'
  valor: string
  aoMudar: (v: string) => void
  aparencia?: 'caixa' | 'linha'
  espacoReservado?: string
  erro?: string | undefined
  dica?: string | undefined
  autoComplete?: string
  referencia?: Ref<HTMLInputElement>
  obrigatorio?: boolean
}): ReactNode {
  const id = useId()
  const idErro = `${id}-erro`
  const idDica = `${id}-dica`
  const descrito = [props.erro ? idErro : null, props.dica ? idDica : null]
    .filter(Boolean).join(' ')
  const aparencia = props.aparencia ?? 'caixa'

  return (
    <div className={cn('group/campo flex flex-col', aparencia === 'linha' ? 'gap-2' : 'gap-1.5')}>
      <label
        htmlFor={id}
        className={cn(
          'text-fg',
          aparencia === 'linha'
            ? 'font-tecnica text-[11px] uppercase tracking-[0.22em] text-fg-muted'
            : 'text-[13px] font-medium',
        )}
      >
        {props.rotulo}
      </label>

      <div className={aparencia === 'linha' ? 'relative' : undefined}>
        <input
          id={id}
          ref={props.referencia}
          type={props.tipo ?? 'text'}
          value={props.valor}
          onChange={e => props.aoMudar(e.target.value)}
          {...(props.autoComplete === undefined ? {} : { autoComplete: props.autoComplete })}
          {...(props.espacoReservado === undefined ? {} : { placeholder: props.espacoReservado })}
          required={props.obrigatorio ?? false}
          aria-invalid={props.erro ? true : undefined}
          aria-describedby={descrito === '' ? undefined : descrito}
          className={cn(
            'w-full bg-transparent text-fg placeholder:text-fg-muted/70',
            'transition-[border-color,background-color,box-shadow] duration-200 ease-out',
            aparencia === 'caixa' && `h-9 rounded-md border border-border-subtle bg-bg px-3
                                      hover:border-border
                                      focus:border-accent aria-[invalid]:border-danger`,
            aparencia === 'linha' && `border-0 border-b border-border-subtle px-0 pb-2.5
                                      text-lg aria-[invalid]:border-danger`,
          )}
        />
        {aparencia === 'linha' && (
          // O tracinho que cresce sob o campo em foco. Decorativo de proposito:
          // o anel de foco global continua sendo quem cumpre a SC 2.4.11 — este
          // aqui some junto com toda animacao sob prefers-reduced-motion, e se
          // fosse o unico sinal de foco levaria o cumprimento embora consigo.
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left
                        scale-x-0 bg-accent transition-transform duration-500
                        ease-[cubic-bezier(0.2,1,0.3,1)]
                        group-focus-within/campo:scale-x-100`}
          />
        )}
      </div>

      {props.dica && (
        <p id={idDica} className="text-xs text-fg-muted">{props.dica}</p>
      )}
      {props.erro && (
        <p id={idErro} className="text-xs text-danger">{props.erro}</p>
      )}
    </div>
  )
}
