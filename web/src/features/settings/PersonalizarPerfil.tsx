import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import type { Usuario } from '../../lib/tipos.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { VisualDoPerfil, corDoBanner } from '../presence/VisualDoPerfil.js'

/**
 * O perfil do jeito da pessoa: banner, pronomes e "sobre mim", como no Discord.
 *
 * A previa ao lado e o cartao EXATAMENTE como os outros o veem — o mesmo
 * componente —, atualizado a cada tecla. Personalizar sem ver o resultado vira
 * tentativa e erro com o cartao alheio.
 */

const ACEITOS = 'image/png,image/jpeg,image/gif,image/webp'
const LIMITE_BYTES = 8 * 1024 * 1024
const LIMITE_DA_BIO = 190
const LIMITE_DOS_PRONOMES = 40

/**
 * Cores prontas para o banner: oito tons que seguram texto e foto por cima nos
 * dois temas. O seletor livre ao lado cobre quem quer outra.
 */
const CORES_DO_BANNER = [
  '#5865f2', '#23a55a', '#1e90ff', '#9b59b6', '#e67e22', '#e91e63', '#2c3e50', '#11806a',
] as const

function aplicarUsuario(novo: Partial<Usuario>): void {
  const atual = useStore.getState().user
  if (atual !== null) useStore.setState({ user: { ...atual, ...novo } })
}

export function PersonalizarPerfil({ aoConfirmar }: {
  /** A mensagem de sucesso, que o `Perfil` anuncia na regiao viva unica dele. */
  aoConfirmar: (recado: string) => void
}): ReactNode {
  const user = useStore(e => e.user)
  const [bio, setBio] = useState(user?.bio ?? '')
  const [pronomes, setPronomes] = useState(user?.pronouns ?? '')
  const [cor, setCor] = useState<string | null>(user?.bannerColor ?? null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'perfil' | 'banner' | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  if (user === null) return null

  const automatica = corDoBanner({ displayName: user.displayName, bannerColor: null })
  const mudou = bio.trim() !== (user.bio ?? '')
    || pronomes.trim() !== (user.pronouns ?? '')
    || cor !== (user.bannerColor ?? null)

  async function salvar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setOcupado('perfil')
    try {
      const r = await api.patch<{ user: Usuario }>('/auth/me', {
        bio: bio.trim(), pronouns: pronomes.trim(), bannerColor: cor,
      })
      aplicarUsuario(r.user)
      aoConfirmar('Perfil atualizado.')
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar o perfil.')
    } finally {
      setOcupado(null)
    }
  }

  async function enviarBanner(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    // Limpar ja: escolher o MESMO arquivo depois de um erro precisa disparar.
    evento.target.value = ''
    if (arquivo === undefined) return
    setErro(null)
    if (arquivo.size > LIMITE_BYTES) {
      setErro('A imagem passa do limite de 8 MB.')
      return
    }
    setOcupado('banner')
    try {
      const corpo = new FormData()
      corpo.append('file', arquivo, arquivo.name)
      const resposta = await fetch('/api/auth/me/banner', {
        method: 'POST', body: corpo, credentials: 'include',
      })
      if (!resposta.ok) {
        const envelope = await resposta.json().catch(() => null) as
          { error?: { message?: string } } | null
        throw new Error(envelope?.error?.message ?? 'Não foi possível enviar o banner.')
      }
      const { bannerUrl } = await resposta.json() as { bannerUrl: string }
      aplicarUsuario({ bannerUrl })
      aoConfirmar('Banner atualizado.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o banner.')
    } finally {
      setOcupado(null)
    }
  }

  async function removerBanner(): Promise<void> {
    setErro(null)
    setOcupado('banner')
    try {
      await api.delete('/auth/me/banner')
      aplicarUsuario({ bannerUrl: null })
      aoConfirmar('Imagem do banner removida.')
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível remover o banner.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <form
      onSubmit={evento => { void salvar(evento) }}
      className="flex flex-col gap-4"
      noValidate
      aria-labelledby="titulo-personalizar"
    >
      <h3 id="titulo-personalizar" className="text-xs uppercase tracking-wide text-fg-muted">
        Personalizar perfil
      </h3>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">Cor do banner</legend>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setCor(null) }}
                aria-pressed={cor === null}
                title="Automática, a mesma cor da sua inicial"
                className="size-8 rounded-full ring-offset-2 ring-offset-bg aria-pressed:ring-2
                           aria-pressed:ring-fg"
                style={{ background: automatica }}
              >
                <span className="sr-only">Cor automática</span>
              </button>
              {CORES_DO_BANNER.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setCor(c) }}
                  aria-pressed={cor === c}
                  title={c}
                  className="size-8 rounded-full ring-offset-2 ring-offset-bg aria-pressed:ring-2
                             aria-pressed:ring-fg"
                  style={{ background: c }}
                >
                  <span className="sr-only">Cor {c}</span>
                </button>
              ))}
              <label
                title="Outra cor"
                className="relative flex size-8 cursor-pointer items-center justify-center
                           overflow-hidden rounded-full border-2 border-dashed border-border
                           text-fg-muted focus-within:ring-2 focus-within:ring-focus-ring"
              >
                <Plus aria-hidden="true" className="size-4" />
                <span className="sr-only">Escolher outra cor</span>
                <input
                  type="color"
                  value={cor ?? automatica}
                  onChange={e => { setCor(e.target.value.toLowerCase()) }}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Imagem do banner</span>
            <input
              ref={entrada}
              type="file"
              accept={ACEITOS}
              onChange={evento => { void enviarBanner(evento) }}
              className="sr-only"
              aria-label="Escolher imagem do banner"
              tabIndex={-1}
            />
            <div className="flex flex-wrap gap-2">
              <Botao
                type="button"
                variante="discreto"
                tamanho="sm"
                disabled={ocupado === 'banner'}
                onClick={() => entrada.current?.click()}
              >
                <ImagePlus aria-hidden="true" className="size-4" />
                {ocupado === 'banner' ? 'Enviando...' : 'Escolher imagem'}
              </Botao>
              {(user.bannerUrl ?? null) !== null && (
                <Botao
                  type="button"
                  variante="fantasma"
                  tamanho="sm"
                  disabled={ocupado === 'banner'}
                  onClick={() => { void removerBanner() }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remover imagem
                </Botao>
              )}
            </div>
            <p className="text-xs text-fg-muted">
              A imagem cobre a cor. É recortada em 5:2 (960 × 384), até 8 MB.
            </p>
          </div>

          <Campo
            rotulo="Pronomes"
            valor={pronomes}
            aoMudar={v => { setPronomes(v.slice(0, LIMITE_DOS_PRONOMES)) }}
            espacoReservado="ele/dele, ela/dela, elu/delu"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="campo-da-bio" className="text-sm font-medium text-fg">Sobre mim</label>
            <textarea
              id="campo-da-bio"
              value={bio}
              onChange={e => { setBio(e.target.value.slice(0, LIMITE_DA_BIO)) }}
              rows={4}
              maxLength={LIMITE_DA_BIO}
              placeholder="Conte um pouco sobre você."
              aria-describedby="contador-da-bio"
              className="resize-y rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm
                         text-fg placeholder:text-fg-muted focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            />
            <span
              id="contador-da-bio"
              className="self-end font-mono text-xs tabular-nums text-fg-muted"
            >
              {bio.length}/{LIMITE_DA_BIO}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span aria-hidden="true" className="text-xs uppercase tracking-wide text-fg-muted">
            Prévia
          </span>
          {/* A previa repete o que os campos ao lado ja dizem: para o leitor
              de tela, ouvir tudo de novo seria so ruido. */}
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-lg border border-border-subtle bg-bg-raised shadow-dialog"
          >
            <VisualDoPerfil
              dados={{
                displayName: user.displayName,
                username: user.username ?? null,
                avatarUrl: user.avatarUrl,
                bio: bio.trim(),
                pronouns: pronomes.trim(),
                bannerColor: cor,
                bannerUrl: user.bannerUrl ?? null,
              }}
            />
          </div>
        </div>
      </div>

      {erro !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}
      <div className="flex justify-end">
        <Botao type="submit" disabled={ocupado === 'perfil' || !mudou}>
          {ocupado === 'perfil' ? 'Salvando...' : 'Salvar perfil'}
        </Botao>
      </div>
    </form>
  )
}
