import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { Avatar } from '../../ui/Avatar.js'
import { contagemDeMembros, textoDoMotivo } from './mensagens.js'

export type Previa =
  | { valid: true; groupName: string; groupIconUrl: string | null; memberCount: number }
  | { valid: false; reason: string }

/**
 * A previa de um codigo, com o estado da busca.
 *
 * Um hook, e nao so o componente, porque tres telas precisam do NOME do grupo
 * para escrever o proprio texto — o cadastro, o login e o dialogo de quem ja
 * esta dentro — e cada uma buscava do seu jeito.
 */
export function usarPrevia(codigo: string): { previa: Previa | null; falhou: boolean } {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vigente = true
    setPrevia(null)
    setFalhou(false)
    api.get<Previa>(`/invites/${codigo}`)
      .then(p => { if (vigente) setPrevia(p) })
      .catch(() => { if (vigente) setFalhou(true) })
    return () => { vigente = false }
  }, [codigo])

  return { previa, falhou }
}

/**
 * O cartao do grupo que convidou.
 *
 * A previa e a unica resposta nao autenticada que carrega dado de grupo, e por
 * isso mostra exatamente tres coisas: nome, icone e contagem. Nenhum canal,
 * nenhum nome de membro, nenhum identificador interno — quem tiver um codigo
 * vazado nao ganha um mapa da organizacao junto.
 *
 * Fica visivel em TODAS as portas por onde o convite passa. Antes ele so
 * existia na tela de cadastro; quem clicava em "Ja tenho conta" ia para um
 * login que nao sabia de convite nenhum, e a pessoa esquecia o que tinha ido
 * fazer ali.
 */
export function PreviaConvite({ codigo, porta = 'cadastro' }: {
  codigo: string
  /** De onde a pessoa vai aceitar: muda so a frase de chamada. */
  porta?: 'cadastro' | 'login'
}): ReactNode {
  const { previa, falhou } = usarPrevia(codigo)

  if (falhou) {
    return (
      <p role="alert" className="mb-6 text-sm text-danger">
        Não foi possível verificar este convite. Tente novamente.
      </p>
    )
  }

  // Esqueleto com as dimensoes finais, para nao haver salto de layout quando a
  // resposta chega.
  if (previa === null) {
    return (
      <div className="mb-6 flex items-center gap-3" aria-hidden="true">
        <div className="size-11 rounded-lg bg-bg-hover" />
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-32 rounded bg-bg-hover" />
          <div className="h-3 w-20 rounded bg-bg-hover" />
        </div>
      </div>
    )
  }

  if (!previa.valid) {
    return (
      <p role="alert" className="mb-6 rounded-md border border-danger px-3 py-2 text-sm text-danger">
        {textoDoMotivo(previa.reason)}
      </p>
    )
  }

  return (
    <section
      aria-label="Convite"
      className="mb-6 flex items-center gap-3 rounded-lg border border-border-subtle
                 bg-bg-raised p-3"
    >
      <Avatar nome={previa.groupName} url={previa.groupIconUrl} className="size-11 rounded-lg" />
      <div className="min-w-0">
        <p className="text-xs text-fg-muted">
          {porta === 'login' ? 'Entre para aceitar o convite de' : 'Você foi convidado para'}
        </p>
        <p className="truncate font-semibold text-fg">{previa.groupName}</p>
        <p className="text-xs text-fg-muted">
          {contagemDeMembros(previa.memberCount)} · código{' '}
          {/* Monoespacada porque este codigo vai ser ditado por telefone. */}
          <code className="font-mono tracking-wider text-fg">{codigo}</code>
        </p>
      </div>
    </section>
  )
}
