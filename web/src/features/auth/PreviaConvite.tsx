import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { contagemDeMembros, textoDoMotivo } from './mensagens.js'

type Previa =
  | { valid: true; groupName: string; groupIconUrl: string | null; memberCount: number }
  | { valid: false; reason: string }

/**
 * A previa e a unica resposta nao autenticada que carrega dado de grupo, e por
 * isso mostra exatamente tres coisas: nome, icone e contagem. Nenhum canal,
 * nenhum nome de membro, nenhum identificador interno — quem tiver um codigo
 * vazado nao ganha um mapa da organizacao junto.
 */
export function PreviaConvite({ codigo, aoEntrar }: {
  codigo: string
  aoEntrar?: () => void
}): ReactNode {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vigente = true
    api.get<Previa>(`/invites/${codigo}`)
      .then(p => { if (vigente) setPrevia(p) })
      .catch(() => { if (vigente) setFalhou(true) })
    return () => { vigente = false }
  }, [codigo])

  if (falhou) {
    return (
      <p role="alert" className="text-sm text-danger">
        Nao foi possivel verificar este convite. Tente novamente.
      </p>
    )
  }

  // Esqueleto com as dimensoes finais, para nao haver salto de layout quando a
  // resposta chega.
  if (previa === null) {
    return (
      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="size-10 rounded bg-bg-hover" />
        <div className="flex flex-col gap-1">
          <div className="h-4 w-32 rounded bg-bg-hover" />
          <div className="h-3 w-20 rounded bg-bg-hover" />
        </div>
      </div>
    )
  }

  if (!previa.valid) {
    return (
      <p role="alert" className="rounded border border-danger px-3 py-2 text-sm text-danger">
        {textoDoMotivo(previa.reason)}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {previa.groupIconUrl === null ? (
          <div
            className="flex size-10 items-center justify-center rounded bg-bg-hover
                       text-sm font-semibold text-fg-muted"
            aria-hidden="true"
          >
            {previa.groupName.slice(0, 1).toUpperCase()}
          </div>
        ) : (
          <img src={previa.groupIconUrl} alt="" className="size-10 rounded" />
        )}
        <div>
          <p className="font-semibold text-fg">{previa.groupName}</p>
          <p className="text-xs text-fg-muted">{contagemDeMembros(previa.memberCount)}</p>
        </div>
      </div>

      <p className="text-sm text-fg-muted">
        Voce foi convidado com o codigo{' '}
        {/* Monoespacada porque este codigo vai ser ditado por telefone. */}
        <code className="font-mono tracking-wider text-fg">{codigo}</code>.
      </p>

      {aoEntrar && (
        <button
          type="button" onClick={aoEntrar}
          className="self-start text-sm text-accent underline underline-offset-4"
        >
          Entrar no grupo
        </button>
      )}
    </div>
  )
}
