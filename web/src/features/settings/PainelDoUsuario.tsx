import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, LogOut, MessageSquareText, Settings, UserRound } from 'lucide-react'
import { possoNoGrupo, useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Configuracoes } from './Configuracoes.js'
import { PERMISSOES_DE_ADMINISTRACAO } from './ConfiguracoesGrupo.js'
import { useDialogoDeConfiguracoes } from './dialogoDeConfiguracoes.js'
import { sairDaConta } from '../auth/sairDaConta.js'
import { Presenca } from '../presence/Presenca.js'
import { DialogoDeStatus } from './DialogoDeStatus.js'
import { ROTULO_DO_STATUS, definirStatus } from './status.js'
import type { StatusEscolhido } from '../../lib/tipos.js'

const ITEM = `flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm
              text-fg outline-none data-[highlighted]:bg-bg-hover`

/**
 * Quem voce e, no rodape da coluna de canais.
 *
 * Numa conta com apelido e nome de usuario separados, e num app onde a mesma
 * pessoa entra de duas maquinas, a pergunta que a interface precisa responder
 * de relance e *quem* esta logado aqui.
 *
 * O nome e o avatar agora abrem um menu — Perfil, Configuracoes, Sair. "Sair"
 * nao existia em tela nenhuma: a rota de logout estava pronta na API havia
 * meses, e a unica saida era apagar os cookies na mao.
 *
 * A engrenagem continua ao lado como atalho direto. Nao e uma segunda porta
 * para a mesma coisa: o menu e o lugar da identidade, e a engrenagem e o
 * gesto de quem ja sabe o que quer ajustar.
 */
export function PainelDoUsuario(): ReactNode {
  const user = useStore(e => e.user)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  /**
   * O MESMO criterio da tela de configuracoes do grupo: alguma permissao que
   * abra uma secao administrativa. Decidir pelo papel, como antes, escondia
   * a aba de quem recebeu `group.invite` por cargo.
   *
   * Continua sendo decisao de APRESENTACAO: quem forcar a rota recebe 404.
   */
  const administra = useStore(e => grupoAtivo !== null
    && PERMISSOES_DE_ADMINISTRACAO.some(acao => possoNoGrupo(e, grupoAtivo, acao)))
  const abrir = useDialogoDeConfiguracoes(e => e.abrir)
  const [statusAberto, setStatusAberto] = useState(false)

  if (!user) return null

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-t border-border-subtle
                 bg-bg-raised px-2 py-1.5"
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={`Conta de ${user.displayName}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left
                       hover:bg-bg-hover data-[state=open]:bg-bg-hover"
          >
            <span className="relative flex shrink-0">
              <Avatar nome={user.displayName} url={user.avatarUrl} tamanho="md" />
              <Presenca status={user.status === 'invisible' ? 'invisible' : user.status ?? 'online'} modo="cracha" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-fg">
                {user.displayName}
              </span>
              {/*
                O nome de usuario so aparece quando existe. Uma linha com
                `@undefined` seria pior do que a ausencia: promete um
                identificador que a conta nao tem.
              */}
              {typeof user.username === 'string' && user.username.length > 0 ? (
                <span className="block truncate font-mono text-xs text-fg-muted">
                  @{user.username}
                </span>
              ) : null}
            </span>
          </button>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-50 min-w-52 rounded-lg border border-border bg-bg-raised p-1
                       shadow-popover"
          >
            <Menu.Label className="px-2 py-1.5 text-xs text-fg-muted">
              Você está como <span className="font-medium text-fg">{user.displayName}</span>
            </Menu.Label>

            {/*
              O status escolhido (Etapa 2.9). Online e o automatico — ausente
              sozinho depois de dez minutos sem uso; os outros tres sao
              decisoes que valem ate a pessoa mudar.
            */}
            <Menu.RadioGroup
              value={user.status ?? 'online'}
              onValueChange={v => { void definirStatus({ status: v as StatusEscolhido }).catch(() => undefined) }}
            >
              {(['online', 'idle', 'dnd', 'invisible'] as const).map(st => (
                <Menu.RadioItem key={st} value={st} className={ITEM}>
                  <span className="relative flex size-4 items-center justify-center">
                    <Presenca status={st === 'invisible' ? 'offline' : st} modo="texto-oculto" />
                  </span>
                  <span className="flex flex-col">
                    {ROTULO_DO_STATUS[st].nome}
                    <span className="text-xs text-fg-muted">{ROTULO_DO_STATUS[st].descricao}</span>
                  </span>
                  <Menu.ItemIndicator className="ml-auto">
                    <Check aria-hidden="true" className="size-4" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Item className={ITEM} onSelect={() => setStatusAberto(true)}>
              <MessageSquareText aria-hidden="true" className="size-4 text-fg-muted" />
              {(user.statusText ?? '') === ''
                ? 'Definir mensagem de status'
                : <span className="min-w-0 truncate">{user.statusEmoji ?? ''} {user.statusText}</span>}
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border-subtle" />
            <Menu.Item className={ITEM} onSelect={() => abrir('perfil')}>
              <UserRound aria-hidden="true" className="size-4 text-fg-muted" />
              Perfil
            </Menu.Item>
            <Menu.Item className={ITEM} onSelect={() => abrir('conta')}>
              <Settings aria-hidden="true" className="size-4 text-fg-muted" />
              Configurações
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border-subtle" />
            <Menu.Item
              className={`${ITEM} text-danger data-[highlighted]:bg-bg-hover`}
              onSelect={() => { void sairDaConta() }}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sair
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <Configuracoes groupId={grupoAtivo} podeAdministrar={administra} />
      <DialogoDeStatus aberto={statusAberto} aoMudar={setStatusAberto} />
    </div>
  )
}
