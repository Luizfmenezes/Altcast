import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { recortarQuadrado } from '../../lib/avatar.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { Separador } from '../../ui/Separador.js'
import type { Usuario } from '../../lib/tipos.js'

/**
 * Quem voce e, para os outros.
 *
 * Tres coisas que o sistema tinha no banco e nao tinha na tela: o nome de
 * exibicao nunca pode ser trocado por ninguem, o handle nao existia, e o
 * avatar era uma coluna de texto que so o Google preenchia.
 *
 * Apelido e nome de usuario ficam juntos aqui, e separados no servidor, porque
 * sao coisas diferentes: o primeiro e como voce quer ser chamado e muda quando
 * der vontade; o segundo e como o sistema te encontra, e por isso e unico e
 * tem limite de troca.
 */

const ACEITOS = 'image/png,image/jpeg,image/gif,image/webp'
const LIMITE_BYTES = 8 * 1024 * 1024

export function Perfil(): ReactNode {
  const user = useStore(e => e.user)
  const [nome, setNome] = useState(user?.displayName ?? '')
  const [handle, setHandle] = useState(user?.username ?? '')
  const [erroNome, setErroNome] = useState<string | null>(null)
  const [erroHandle, setErroHandle] = useState<string | null>(null)
  const [erroFoto, setErroFoto] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'nome' | 'handle' | 'foto' | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  function aplicarUsuario(novo: Partial<Usuario>): void {
    const atual = useStore.getState().user
    if (atual !== null) useStore.setState({ user: { ...atual, ...novo } })
  }

  async function salvarNome(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErroNome(null)
    setOcupado('nome')
    try {
      const r = await api.patch<{ user: Usuario }>('/auth/me', { displayName: nome.trim() })
      aplicarUsuario(r.user)
      setRecado('Nome de exibição atualizado.')
    } catch (e) {
      setErroNome(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    } finally {
      setOcupado(null)
    }
  }

  async function salvarHandle(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErroHandle(null)
    setOcupado('handle')
    try {
      const r = await api.patch<{ user: { username: string } }>(
        '/auth/me/username', { username: handle.trim() },
      )
      aplicarUsuario({ username: r.user.username })
      setHandle(r.user.username)
      setRecado('Nome de usuário atualizado.')
    } catch (e) {
      // O servidor devolve o motivo exato em `details.username`; a mensagem
      // generica so entra quando nao ha motivo por campo.
      const porCampo = e instanceof ApiError ? e.camposInvalidos['username']?.[0] : undefined
      setErroHandle(porCampo ?? (e instanceof ApiError ? e.message : 'Não foi possível salvar.'))
    } finally {
      setOcupado(null)
    }
  }

  async function enviarFoto(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    // Limpar o input aqui, e nao no fim: sem isto, escolher o MESMO arquivo de
    // novo depois de um erro nao dispara `change` e parece que travou.
    evento.target.value = ''
    if (arquivo === undefined) return

    setErroFoto(null)
    if (arquivo.size > LIMITE_BYTES) {
      setErroFoto('A imagem passa do limite de 8 MB.')
      return
    }

    setOcupado('foto')
    try {
      // Recortado aqui, a subida vira ~30 KB em vez de varios megabytes. Se o
      // navegador nao entregar canvas, sobe o original e o servidor resolve.
      const recortado = await recortarQuadrado(arquivo)
      const corpo = new FormData()
      corpo.append('file', recortado ?? arquivo, 'avatar.webp')

      const resposta = await fetch('/api/auth/me/avatar', {
        method: 'POST', body: corpo, credentials: 'include',
      })
      if (!resposta.ok) {
        const envelope = await resposta.json().catch(() => null) as
          { error?: { message?: string } } | null
        throw new Error(envelope?.error?.message ?? 'Não foi possível enviar a foto.')
      }

      const { avatarUrl } = await resposta.json() as { avatarUrl: string }
      aplicarUsuario({ avatarUrl })
      setRecado('Foto atualizada.')
    } catch (e) {
      setErroFoto(e instanceof Error ? e.message : 'Não foi possível enviar a foto.')
    } finally {
      setOcupado(null)
    }
  }

  async function removerFoto(): Promise<void> {
    setErroFoto(null)
    setOcupado('foto')
    try {
      await api.delete('/auth/me/avatar')
      aplicarUsuario({ avatarUrl: null })
      setRecado('Foto removida.')
    } catch (e) {
      setErroFoto(e instanceof ApiError ? e.message : 'Não foi possível remover a foto.')
    } finally {
      setOcupado(null)
    }
  }

  if (user === null) return null

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-wide text-fg-muted">Foto</h3>
        <div className="flex items-center gap-4">
          {/*
            A previa e o mesmo componente da barra lateral, e nao uma imagem
            solta: assim a cor de iniciais de quem nao tem foto e exatamente a
            que os outros veem.
          */}
          <Avatar nome={user.displayName} url={user.avatarUrl} tamanho="xl" />
          <div className="flex flex-col gap-2">
            <input
              ref={entrada}
              type="file"
              accept={ACEITOS}
              onChange={evento => { void enviarFoto(evento) }}
              className="sr-only"
              id="foto-de-perfil"
              // Nome proprio porque o campo esta fora da vista e nao tem
              // `<label>` visivel — quem o alcanca por leitor de tela precisa
              // ouvir o que ele e. `tabIndex={-1}` porque o botao ao lado ja e
              // o caminho de teclado: dois paradas para a mesma acao so
              // confundem.
              aria-label="Escolher foto de perfil"
              tabIndex={-1}
            />
            <div className="flex flex-wrap gap-2">
              <Botao
                type="button"
                variante="discreto"
                disabled={ocupado === 'foto'}
                onClick={() => entrada.current?.click()}
              >
                <Upload aria-hidden="true" className="size-4" />
                {ocupado === 'foto' ? 'Enviando...' : 'Escolher foto'}
              </Botao>
              {user.avatarUrl !== null && (
                <Botao
                  type="button"
                  variante="fantasma"
                  disabled={ocupado === 'foto'}
                  onClick={() => { void removerFoto() }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remover
                </Botao>
              )}
            </div>
            <p className="text-xs text-fg-muted">PNG, JPEG, GIF ou WebP, até 8 MB.</p>
          </div>
        </div>
        {erroFoto !== null && (
          <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
            {erroFoto}
          </p>
        )}
      </section>

      <Separador />

      <form onSubmit={evento => { void salvarNome(evento) }} className="flex flex-col gap-3" noValidate>
        <h3 className="text-xs uppercase tracking-wide text-fg-muted">Nome de exibição</h3>
        <Campo
          rotulo="Como os outros te veem"
          valor={nome}
          aoMudar={setNome}
          dica="Pode repetir com outras pessoas, e você muda quando quiser."
          {...(erroNome === null ? {} : { erro: erroNome })}
        />
        <div className="flex justify-end">
          <Botao
            type="submit"
            disabled={ocupado === 'nome' || nome.trim().length < 2 || nome.trim() === user.displayName}
          >
            {ocupado === 'nome' ? 'Salvando...' : 'Salvar nome'}
          </Botao>
        </div>
      </form>

      <Separador />

      <form onSubmit={evento => { void salvarHandle(evento) }} className="flex flex-col gap-3" noValidate>
        <h3 className="text-xs uppercase tracking-wide text-fg-muted">Nome de usuário</h3>
        <Campo
          rotulo="Como te encontram"
          valor={handle}
          aoMudar={setHandle}
          espacoReservado="felipe"
          dica="Único no Altcast. Só pode ser trocado uma vez por mês."
          {...(erroHandle === null ? {} : { erro: erroHandle })}
        />
        <div className="flex justify-end">
          <Botao
            type="submit"
            disabled={
              ocupado === 'handle'
              || handle.trim().length < 3
              || handle.trim().toLowerCase() === (user.username ?? '')
            }
          >
            {ocupado === 'handle' ? 'Salvando...' : 'Salvar nome de usuário'}
          </Botao>
        </div>
      </form>

      {/*
        Uma regiao viva so, no fim: tres confirmacoes separadas competiriam
        entre si no leitor de tela, e a ultima venceria de qualquer jeito.
      */}
      <p role="status" className="min-h-5 text-xs text-fg-muted">{recado ?? ''}</p>
    </div>
  )
}
