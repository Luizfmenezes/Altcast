import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { Search, X } from 'lucide-react'
import { useStore } from '../../lib/store.js'
import { abrirConversaCom, pessoasAlcancaveis } from '../../lib/conversas.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Presenca, ROTULO_DE_PRESENCA } from '../presence/Presenca.js'

/** Sem acento e sem caixa: "joao" acha "João". */
const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Escolher com quem conversar.
 *
 * A lista e exatamente quem o servidor deixaria: quem divide um grupo comigo.
 * Mostrar mais seria oferecer um clique que volta 404.
 */
export function NovaConversa({ aberta, aoMudar }: {
  aberta: boolean
  aoMudar: (aberta: boolean) => void
}): ReactNode {
  const members = useStore(e => e.members)
  const groups = useStore(e => e.groups)
  const user = useStore(e => e.user)
  const [busca, setBusca] = useState('')
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const pessoas = useMemo(() => {
    const todas = pessoasAlcancaveis({ members, groups, user })
    const alvo = normalizar(busca.trim())
    return alvo === '' ? todas : todas.filter(p => normalizar(p.displayName).includes(alvo))
  }, [members, groups, user, busca])

  async function escolher(userId: string): Promise<void> {
    setAbrindo(userId)
    setErro(null)
    try {
      await abrirConversaCom(userId)
      aoMudar(false)
      setBusca('')
    } catch {
      setErro('Não deu para abrir a conversa. Tente de novo.')
    } finally {
      setAbrindo(null)
    }
  }

  return (
    <Dialogo.Root open={aberta} onOpenChange={aoMudar}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialogo.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden
                     rounded-t-[28px] border border-border-subtle bg-bg-raised shadow-dialog
                     sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(26rem,calc(100%-2rem))]
                     sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <Dialogo.Title className="text-xl font-semibold text-fg">Nova conversa</Dialogo.Title>
            <Dialogo.Close asChild>
              <Botao variante="fantasma" tamanho="iconeSm">
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Botao>
            </Dialogo.Close>
          </div>
          <Dialogo.Description className="px-5 text-sm text-fg-muted">
            Converse com quem está em algum grupo com você.
          </Dialogo.Description>

          <label className="mx-5 mt-4 flex h-11 items-center gap-2 rounded-full bg-bg-sunken px-4
                            text-fg-muted focus-within:ring-2 focus-within:ring-focus-ring">
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">Buscar pessoa</span>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar pessoa"
              // O anel e o da pilula inteira (`focus-within` acima); o do campo
              // por dentro desenharia um segundo contorno dentro do primeiro.
              className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none
                         placeholder:text-fg-muted focus-visible:outline-none"
              autoFocus
            />
          </label>

          {erro !== null && <p role="alert" className="mx-5 mt-3 text-sm text-danger">{erro}</p>}

          <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
            {pessoas.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-fg-muted">
                {busca === '' ? 'Ninguém por aqui ainda. Convide alguém para um grupo.' : 'Ninguém com esse nome.'}
              </li>
            )}
            {pessoas.map(p => (
              <li key={p.userId}>
                <button
                  type="button"
                  disabled={abrindo !== null}
                  onClick={() => { void escolher(p.userId) }}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left
                             transition-colors hover:bg-bg-hover disabled:opacity-60"
                >
                  <span className="relative flex shrink-0">
                    <Avatar nome={p.displayName} url={p.avatarUrl} tamanho="lg" />
                    <Presenca status={p.status} modo="cracha" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium text-fg">{p.displayName}</span>
                    <span className="truncate text-[13px] text-fg-muted">
                      {abrindo === p.userId ? 'Abrindo…' : ROTULO_DE_PRESENCA[p.status]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
