import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Check, Trash2, UserPlus } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { Separador } from '../../ui/Separador.js'

type Pendente = {
  id: string
  email: string
  role: 'owner' | 'admin' | 'member'
  createdAt: string
}

type Conhecido = {
  id: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Convidar uma pessoa, e nao gerar um link.
 *
 * Duas entradas para a mesma coisa. O campo de e-mail atende quem esta de
 * fora; o seletor atende quem voce ja conhece aqui dentro e poupa digitar um
 * endereco que voce talvez nem saiba de cor.
 *
 * A resposta e sempre a mesma frase, e isso e deliberado: o servidor nao conta
 * se aquele endereco tem conta aqui, e a tela nao pode contar por ele. Dizer
 * "convite enviado" num caso e "entregue no aplicativo" no outro
 * transformaria este campo num verificador de quem usa o Altcast.
 */
export function ConvidarPessoa({ groupId }: { groupId: string }): ReactNode {
  const [email, setEmail] = useState('')
  const [busca, setBusca] = useState('')
  const [conhecidos, setConhecidos] = useState<Conhecido[]>([])
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function recarregar(): Promise<void> {
    const lista = await api.get<Pendente[]>(`/groups/${groupId}/invitations`).catch(() => null)
    if (Array.isArray(lista)) setPendentes(lista)
  }

  useEffect(() => {
    let vigente = true
    api.get<Pendente[]>(`/groups/${groupId}/invitations`)
      .then(lista => { if (vigente && Array.isArray(lista)) setPendentes(lista) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [groupId])

  // Busca com folga de 250 ms: digitar oito letras dispararia oito
  // requisicoes, e so a ultima interessa.
  useEffect(() => {
    let vigente = true
    const id = window.setTimeout(() => {
      api.get<Conhecido[]>(`/groups/${groupId}/invitable?q=${encodeURIComponent(busca)}`)
        .then(lista => { if (vigente && Array.isArray(lista)) setConhecidos(lista) })
        .catch(() => undefined)
    }, 250)
    return () => { vigente = false; window.clearTimeout(id) }
  }, [groupId, busca])

  async function convidar(corpo: { email: string } | { userId: string }): Promise<void> {
    setErro(null)
    setAviso(null)
    setEnviando(true)
    try {
      await api.post(`/groups/${groupId}/invitations`, corpo)
      setAviso('Convite enviado.')
      setEmail('')
      setBusca('')
      await recarregar()
      // O seletor precisa esquecer quem acabou de ser convidado; a rota ja
      // exclui quem tem convite pendente, entao basta perguntar de novo.
      const lista = await api.get<Conhecido[]>(`/groups/${groupId}/invitable`).catch(() => null)
      if (Array.isArray(lista)) setConhecidos(lista)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel enviar o convite.')
    } finally {
      setEnviando(false)
    }
  }

  async function revogar(id: string): Promise<void> {
    setPendentes(atuais => atuais.filter(p => p.id !== id))
    try {
      await api.delete(`/groups/${groupId}/invitations/${id}`)
    } catch {
      // Recarrega para nao deixar na tela um estado que o servidor nao
      // confirmou.
      await recarregar()
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-fg">Convidar uma pessoa</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Quem ja usa o Altcast recebe o convite dentro do aplicativo. Quem ainda nao usa
          recebe um e-mail com o caminho para criar a conta.
        </p>
      </div>

      {erro !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}
      {aviso !== null && (
        <p role="status"
          className="flex items-center gap-2 rounded-md border border-border-subtle
                     px-3 py-2 text-sm text-fg-muted">
          <Check aria-hidden="true" className="size-4 text-presence-online" />
          {aviso}
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: FormEvent) => { e.preventDefault(); void convidar({ email }) }}
        noValidate
      >
        <div className="min-w-56 flex-1">
          <Campo
            rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail}
            autoComplete="off"
          />
        </div>
        <Botao type="submit" disabled={enviando || email.trim() === ''}>
          <UserPlus aria-hidden="true" />
          {enviando ? 'Enviando...' : 'Convidar'}
        </Botao>
      </form>

      {/* O seletor so aparece quando ha alguem para escolher. Um campo de
          busca permanentemente vazio prometeria uma lista que nao existe para
          quem esta no primeiro grupo. */}
      {(conhecidos.length > 0 || busca !== '') && (
        <div className="flex flex-col gap-2">
          <Campo
            rotulo="Ou escolha entre pessoas que voce ja conhece"
            valor={busca} aoMudar={setBusca} autoComplete="off"
            dica="Aparecem apenas pessoas com quem voce ja divide algum grupo."
          />
          <ul className="flex max-h-48 list-none flex-col gap-1 overflow-y-auto">
            {conhecidos.map(pessoa => (
              <li key={pessoa.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                <Avatar nome={pessoa.displayName} url={pessoa.avatarUrl} tamanho="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {pessoa.displayName}
                </span>
                <Botao
                  variante="fantasma" tamanho="sm" disabled={enviando}
                  onClick={() => { void convidar({ userId: pessoa.id }) }}
                >
                  Convidar
                </Botao>
              </li>
            ))}
            {conhecidos.length === 0 && (
              <li className="px-1 py-2 text-[13px] text-fg-muted">
                Ninguem encontrado com esse nome.
              </li>
            )}
          </ul>
        </div>
      )}

      {pendentes.length > 0 && (
        <>
          <Separador />
          <div>
            <h4 className="text-[13px] font-medium text-fg">Convites aguardando resposta</h4>
            <ul className="mt-2 flex list-none flex-col gap-2">
              {pendentes.map(p => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border
                             border-border-subtle bg-bg px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{p.email}</span>
                  {p.role === 'admin' && (
                    <span className="text-[11px] text-fg-muted">administrador</span>
                  )}
                  <ConfirmarAcao
                    gatilho={
                      <Botao variante="fantasma" tamanho="iconeSm">
                        <Trash2 aria-hidden="true" />
                        <span className="sr-only">Cancelar o convite de {p.email}</span>
                      </Botao>
                    }
                    titulo="Cancelar este convite?"
                    descricao={
                      'A pessoa deixa de ver o convite. Voce pode convida-la de novo '
                      + 'a qualquer momento.'
                    }
                    confirmar="Cancelar convite"
                    aoConfirmar={() => { void revogar(p.id) }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
