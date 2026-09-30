import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'
import { PRAZOS_DO_STATUS, definirStatus, prazoDoStatus } from './status.js'

/**
 * A frase do status: "Em reuniao ate as 15h", "De ferias".
 *
 * A frase responde o que o ponto colorido nao responde — POR QUE a pessoa
 * nao esta respondendo, e quando volta. Aparece na lista de membros e no
 * cartao de perfil, e some sozinha no prazo escolhido.
 */
export function DialogoDeStatus({ aberto, aoMudar }: {
  aberto: boolean
  aoMudar: (aberto: boolean) => void
}): ReactNode {
  const user = useStore(e => e.user)
  const [texto, setTexto] = useState('')
  const [emoji, setEmoji] = useState('')
  const [prazo, setPrazo] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setTexto(user?.statusText ?? '')
    setEmoji(user?.statusEmoji ?? '')
    setPrazo(null)
    setErro(null)
  }, [aberto, user])

  async function salvar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setSalvando(true)
    setErro(null)
    try {
      await definirStatus({
        status: user?.status ?? 'online',
        text: texto.trim() === '' ? null : texto.trim(),
        emoji: emoji.trim() === '' ? null : emoji.trim(),
        expiresAt: prazoDoStatus(prazo),
      })
      aoMudar(false)
    } catch {
      setErro('Não foi possível salvar o status. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  async function limpar(): Promise<void> {
    setSalvando(true)
    try {
      await definirStatus({ status: user?.status ?? 'online', text: null, emoji: null, expiresAt: null })
      aoMudar(false)
    } catch {
      setErro('Não foi possível limpar o status. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialogo.Root open={aberto} onOpenChange={aoMudar}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2
                     -translate-y-1/2 rounded-lg border border-border-subtle bg-bg-raised p-5 shadow-dialog"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialogo.Title className="text-base font-semibold text-fg">Mensagem de status</Dialogo.Title>
              <Dialogo.Description className="mt-1 text-sm text-fg-muted">
                Aparece ao lado do seu nome, para quem divide grupos com você.
              </Dialogo.Description>
            </div>
            <Dialogo.Close asChild>
              <Botao variante="fantasma" tamanho="iconeSm">
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Botao>
            </Dialogo.Close>
          </div>

          <form onSubmit={e => { void salvar(e) }} className="flex flex-col gap-4">
            <div className="flex gap-2">
              <label className="flex w-16 flex-col gap-1">
                <span className="text-sm font-medium text-fg">Emoji</span>
                <input
                  value={emoji}
                  onChange={e => setEmoji(e.target.value)}
                  maxLength={8}
                  placeholder="📅"
                  className="h-9 rounded-md border border-border-subtle bg-bg-sunken px-2 text-center text-base text-fg"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium text-fg">Frase</span>
                <input
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  maxLength={128}
                  placeholder="Em reunião até as 15h"
                  className="h-9 rounded-md border border-border-subtle bg-bg-sunken px-3 text-sm text-fg
                             placeholder:text-fg-muted"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-fg">Limpar depois de</span>
              <select
                value={prazo === null ? '' : String(prazo)}
                onChange={e => setPrazo(e.target.value === '' ? null : Number(e.target.value))}
                className="h-9 rounded-md border border-border-subtle bg-bg-sunken px-2 text-sm text-fg"
              >
                {PRAZOS_DO_STATUS.map(p => (
                  <option key={p.rotulo} value={p.minutos === null ? '' : String(p.minutos)}>{p.rotulo}</option>
                ))}
              </select>
            </label>

            {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

            <div className="flex justify-end gap-2">
              {(user?.statusText ?? '') !== '' && (
                <Botao type="button" variante="fantasma" onClick={() => { void limpar() }} disabled={salvando}>
                  Limpar status
                </Botao>
              )}
              <Botao type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>
            </div>
          </form>
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
