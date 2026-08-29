import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { useStore } from '../../lib/store.js'
import { LIMITE_DE_CARACTERES, enviarMensagem } from './envio.js'

/** Spec 04 secao 9: o cliente emite `typing` no maximo a cada 3 segundos. */
const INTERVALO_DE_TYPING_MS = 3000

/** Contador so aparece perto do limite; mostra-lo sempre seria ruido. */
const AVISAR_A_PARTIR_DE = 3800

/**
 * Campo de escrita.
 *
 * Enter envia e Shift+Enter quebra linha - a convencao da categoria, e trocar
 * isso obrigaria a reaprender o gesto mais repetido do dia.
 */
export function Composer({ campo, aoDigitar, aoFocar, aoDesfocar, desativado }: {
  campo: RefObject<HTMLTextAreaElement | null>
  aoDigitar?: () => void
  aoFocar?: () => void
  aoDesfocar?: () => void
  desativado?: boolean
}): ReactNode {
  const canalAtivo = useStore(e => e.canalAtivo)
  const [texto, setTexto] = useState('')
  const ultimoTyping = useRef(0)

  const excedeu = texto.length > LIMITE_DE_CARACTERES
  const podeEnviar = texto.trim() !== '' && !excedeu && canalAtivo !== null

  function enviar(): void {
    if (!podeEnviar || canalAtivo === null) return
    const conteudo = texto.trim()
    // Limpar antes de esperar a rede: o eco ja segurou o texto, e o campo
    // pronto para a proxima frase e o que faz a conversa fluir.
    setTexto('')
    void enviarMensagem(canalAtivo, conteudo)
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>): void {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      enviar()
    }
  }

  function aoMudar(valor: string): void {
    setTexto(valor)
    // Estrangular no cliente: um evento por tecla digitada inundaria o socket
    // com a informacao menos valiosa que ele carrega.
    const agora = Date.now()
    if (agora - ultimoTyping.current >= INTERVALO_DE_TYPING_MS) {
      ultimoTyping.current = agora
      aoDigitar?.()
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
        aria-invalid={excedeu ? true : undefined}
        aria-describedby={texto.length >= AVISAR_A_PARTIR_DE ? 'contador' : undefined}
        onChange={e => aoMudar(e.target.value)}
        onKeyDown={aoTeclar}
        onFocus={aoFocar}
        onBlur={aoDesfocar}
        placeholder="Escrever..."
        className="w-full resize-none rounded border border-border bg-bg px-3 py-2 text-sm
                   text-fg placeholder:text-fg-muted"
      />

      {texto.length >= AVISAR_A_PARTIR_DE && (
        <p
          id="contador"
          className={`mt-1 text-right font-mono text-[11px] ${
            excedeu ? 'text-danger' : 'text-fg-muted'
          }`}
        >
          {texto.length} / {LIMITE_DE_CARACTERES}
        </p>
      )}
    </div>
  )
}
