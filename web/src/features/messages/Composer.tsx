import { useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'

/**
 * Campo de escrita. Enter envia, Shift+Enter quebra linha - a convencao da
 * categoria, e trocar isso obrigaria a reaprender o gesto mais repetido do dia.
 */
export function Composer({ campo, aoEnviar, aoFocar, aoDesfocar, desativado }: {
  campo: RefObject<HTMLTextAreaElement | null>
  aoEnviar: (texto: string) => void
  aoFocar?: () => void
  aoDesfocar?: () => void
  desativado?: boolean
}): ReactNode {
  const [texto, setTexto] = useState('')

  function enviar(): void {
    const limpo = texto.trim()
    if (limpo === '') return
    setTexto('')
    aoEnviar(limpo)
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      enviar()
    }
  }

  return (
    <div className="border-t border-border-subtle" style={{ padding: 'var(--space-gutter)' }}>
      <label htmlFor="composer" className="sr-only">Escrever mensagem</label>
      <textarea
        id="composer"
        ref={campo}
        rows={2}
        value={texto}
        disabled={desativado ?? false}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={aoFocar}
        onBlur={aoDesfocar}
        placeholder="Escrever..."
        className="w-full resize-none rounded border border-border bg-bg px-3 py-2 text-sm
                   text-fg placeholder:text-fg-muted"
      />
    </div>
  )
}
