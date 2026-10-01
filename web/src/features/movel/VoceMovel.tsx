import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AtSign, Bell, ChevronRight, Download, Headphones, Keyboard, LogOut, Mail, MessageSquareText,
  Moon, Pencil, ShieldCheck, Share, Sun, UserRound,
} from 'lucide-react'
import { useStore } from '../../lib/store.js'
import type { StatusEscolhido } from '../../lib/tipos.js'
import { Avatar } from '../../ui/Avatar.js'
import { useTheme } from '../../ui/ThemeProvider.js'
import { cn } from '../../lib/utils.js'
import { ativarNotificacoes, permissao } from '../../lib/notificacoes.js'
import { ehIos, useInstalacao } from '../../lib/instalacao.js'
import { useDialogoDeConfiguracoes } from '../settings/dialogoDeConfiguracoes.js'
import type { AbaDeConfiguracoes } from '../settings/dialogoDeConfiguracoes.js'
import { DialogoDeStatus } from '../settings/DialogoDeStatus.js'
import { ROTULO_DO_STATUS, definirStatus } from '../settings/status.js'
import { sairDaConta } from '../auth/sairDaConta.js'
import { Presenca } from '../presence/Presenca.js'

const STATUS: StatusEscolhido[] = ['online', 'idle', 'dnd', 'invisible']

/**
 * A aba "Voce": a conta inteira numa tela, em cartoes.
 *
 * O que no desktop mora num menu do rodape e num dialogo de configuracoes
 * aqui vira pagina: no celular nao ha rodape de coluna, e um menu suspenso
 * com doze itens nao cabe no polegar.
 */
export function VoceMovel(): ReactNode {
  const user = useStore(e => e.user)
  const abrir = useDialogoDeConfiguracoes(e => e.abrir)
  const { theme, setTheme } = useTheme()
  const [statusAberto, setStatusAberto] = useState(false)

  if (user === null) return null
  const status = user.status ?? 'online'

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-3">
      <h1 className="text-center text-[17px] font-semibold text-fg">Perfil</h1>

      <section className="flex flex-col items-center gap-3">
        <span className="relative">
          <Avatar
            nome={user.displayName}
            url={user.avatarUrl}
            tamanho="xl"
            className="size-28 text-[40px] ring-4 ring-bg-raised"
          />
          <button
            type="button"
            onClick={() => abrir('perfil')}
            className="absolute -bottom-1 -right-1 flex size-10 items-center justify-center rounded-2xl
                       border border-border-subtle bg-bg-raised text-fg shadow-popover"
          >
            <Pencil aria-hidden="true" className="size-4" />
            <span className="sr-only">Editar perfil</span>
          </button>
        </span>
        <div className="text-center leading-tight">
          <p className="text-2xl font-semibold tracking-tight text-fg">{user.displayName}</p>
          {typeof user.username === 'string' && user.username !== '' && (
            <p className="mt-1 font-mono text-sm text-fg-muted">@{user.username}</p>
          )}
        </div>
      </section>

      <Cartao titulo="Status">
        <div className="grid grid-cols-2 gap-2 p-3" role="radiogroup" aria-label="Seu status">
          {STATUS.map(s => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => { void definirStatus({ status: s }).catch(() => undefined) }}
              className={cn(
                'flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-medium transition-colors',
                status === s ? 'bg-fg text-bg' : 'bg-bg-hover text-fg',
              )}
            >
              <span className="relative flex size-4 items-center justify-center">
                <Presenca status={s === 'invisible' ? 'offline' : s} modo="texto-oculto" />
              </span>
              {ROTULO_DO_STATUS[s].nome}
            </button>
          ))}
        </div>
        <Linha
          Icone={MessageSquareText}
          rotulo={(user.statusText ?? '') === '' ? 'Definir mensagem de status' : `${user.statusEmoji ?? ''} ${user.statusText ?? ''}`}
          aoTocar={() => setStatusAberto(true)}
        />
      </Cartao>

      <Cartao titulo="Informações">
        <Info Icone={UserRound} rotulo="Nome" valor={user.displayName} />
        {typeof user.username === 'string' && user.username !== '' && (
          <Info Icone={AtSign} rotulo="Nome de usuário" valor={`@${user.username}`} />
        )}
        {user.email !== undefined && <Info Icone={Mail} rotulo="E-mail" valor={user.email} />}
      </Cartao>

      <Cartao titulo="Configurações">
        {([
          ['perfil', UserRound, 'Perfil'],
          ['conta', ShieldCheck, 'Conta e segurança'],
          ['midia', Headphones, 'Áudio e vídeo'],
          ['atalhos', Keyboard, 'Atalhos'],
        ] as [AbaDeConfiguracoes, LucideIcon, string][]).map(([aba, Icone, rotulo]) => (
          <Linha key={aba} Icone={Icone} rotulo={rotulo} aoTocar={() => abrir(aba)} />
        ))}
        <Linha
          Icone={theme === 'dark' ? Moon : Sun}
          rotulo={theme === 'dark' ? 'Tema escuro' : 'Tema claro'}
          detalhe="Trocar"
          aoTocar={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      </Cartao>

      <Aplicativo />

      <button
        type="button"
        onClick={() => { void sairDaConta() }}
        className="flex h-12 items-center justify-center gap-2 rounded-full border border-border-subtle
                   text-[15px] font-semibold text-danger active:bg-bg-hover"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Sair da conta
      </button>

      <DialogoDeStatus aberto={statusAberto} aoMudar={setStatusAberto} />
    </div>
  )
}

/** Instalar o app e ligar os avisos: as duas coisas que fazem o celular virar o Altcast. */
function Aplicativo(): ReactNode {
  const pedido = useInstalacao(e => e.pedido)
  const instalado = useInstalacao(e => e.instalado)
  const instalar = useInstalacao(e => e.instalar)
  const [avisos, setAvisos] = useState(permissao)
  const [comoNoIphone, setComoNoIphone] = useState(false)

  const podeInstalar = !instalado && (pedido !== null || ehIos())

  return (
    <Cartao titulo="Aplicativo">
      {podeInstalar && (
        <Linha
          Icone={Download}
          rotulo="Instalar o Altcast"
          detalhe="Tela inicial"
          aoTocar={() => {
            if (pedido !== null) { void instalar(); return }
            setComoNoIphone(a => !a)
          }}
        />
      )}
      {comoNoIphone && (
        <p className="flex items-start gap-2 px-4 pb-3 text-sm text-fg-muted">
          <Share aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.
        </p>
      )}
      {instalado && <Info Icone={Download} rotulo="Aplicativo" valor="Instalado neste aparelho" />}
      {avisos !== 'indisponivel' && (
        <Linha
          Icone={Bell}
          rotulo="Notificações"
          detalhe={avisos === 'granted' ? 'Ligadas' : avisos === 'denied' ? 'Bloqueadas no navegador' : 'Ligar'}
          {...(avisos === 'default'
            ? { aoTocar: () => { void ativarNotificacoes().then(() => setAvisos(permissao())) } }
            : {})}
        />
      )}
    </Cartao>
  )
}

function Cartao({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-lg font-semibold tracking-tight text-fg">{titulo}</h2>
      <div className="flex flex-col overflow-hidden rounded-[22px] bg-bg-raised [&>*+*]:border-t [&>*+*]:border-border-subtle">
        {children}
      </div>
    </section>
  )
}

function Info({ Icone, rotulo, valor }: { Icone: LucideIcon; rotulo: string; valor: string }): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icone aria-hidden="true" className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} />
      <div className="min-w-0 leading-tight">
        <p className="text-xs text-fg-muted">{rotulo}</p>
        <p className="truncate text-[15px] text-fg">{valor}</p>
      </div>
    </div>
  )
}

function Linha({ Icone, rotulo, detalhe, aoTocar }: {
  Icone: LucideIcon
  rotulo: string
  detalhe?: string
  aoTocar?: () => void
}): ReactNode {
  const conteudo = (
    <>
      <Icone aria-hidden="true" className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{rotulo}</span>
      {detalhe !== undefined && <span className="shrink-0 text-sm text-fg-muted">{detalhe}</span>}
      {aoTocar !== undefined && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />}
    </>
  )
  if (aoTocar === undefined) return <div className="flex items-center gap-3 px-4 py-3.5">{conteudo}</div>
  return (
    <button type="button" onClick={aoTocar} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-bg-hover">
      {conteudo}
    </button>
  )
}
