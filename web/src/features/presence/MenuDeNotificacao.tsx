import type { ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Bell, BellOff, Check } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import {
  DURACOES_DE_SILENCIO, ROTULO_DO_NIVEL, nivelDoGrupo, nivelPadraoDoGrupo, nivelProprio, prazoDoSilencio, silenciadoAte,
} from '../../lib/atencao.js'
import type { NivelDeNotificacao, PreferenciaDeNotificacao } from '../../lib/tipos.js'
import { cn } from '../../lib/utils.js'

const ITEM = `flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm
              text-fg outline-none data-[highlighted]:bg-bg-hover`

const NIVEIS: NivelDeNotificacao[] = ['all', 'mentions', 'none']

const QUANDO = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * "O que quero ouvir daqui", para um canal ou um grupo (Etapa 2.4).
 *
 * Dois eixos independentes, como a pessoa pensa neles: o NIVEL (tudo, so
 * mencoes, nada — ou herdar) e o SILENCIO por um tempo. Silenciar
 * por uma hora nao deveria obrigar a lembrar qual era o nivel para voltar a
 * ele depois, e por isso nao mexe no nivel.
 *
 * A resposta do servidor e aplicada na hora pelo mesmo redutor do evento: a
 * tela nao espera o socket para mostrar o que a pessoa acabou de escolher.
 */
export function MenuDeNotificacao({ scopeType, scopeId, groupId, gatilho }: {
  scopeType: 'group' | 'channel'
  scopeId: string
  /** O grupo do canal, para mostrar o que "herdar" significa. */
  groupId: string
  gatilho?: ReactNode
}): ReactNode {
  const preferencias = useStore(e => e.preferencias)
  const members = useStore(e => e.members)
  const aplicarEvento = useStore(e => e.aplicarEvento)

  const proprio = nivelProprio(preferencias, scopeType, scopeId)
  const ate = silenciadoAte(preferencias, scopeType, scopeId)
  // O que "herdar" significa aqui: o nivel do grupo (para um canal) ou o
  // padrao pelo tamanho do grupo (para o grupo).
  const herdado = scopeType === 'channel'
    ? nivelDoGrupo({ preferencias, members }, groupId)
    : nivelPadraoDoGrupo({ members }, groupId)

  async function gravar(mudanca: { level?: NivelDeNotificacao | null; mutedUntil?: string | null }): Promise<void> {
    const atual = preferencias.find(p => p.scopeType === scopeType && p.scopeId === scopeId)
    const corpo = {
      scopeType, scopeId,
      level: mudanca.level !== undefined ? mudanca.level : atual?.level ?? null,
      mutedUntil: mudanca.mutedUntil !== undefined ? mudanca.mutedUntil : atual?.mutedUntil ?? null,
    }
    try {
      const r = await api.put<PreferenciaDeNotificacao>('/notification-prefs', corpo)
      aplicarEvento({ t: 'notification-prefs.updated', d: r })
    } catch {
      // Falhou: nada muda na tela, que e a resposta honesta.
    }
  }

  const rotulo = scopeType === 'channel' ? 'Notificações do canal' : 'Notificações do grupo'
  // "Ate eu reativar" e um prazo de dez anos: dizer a data seria esquisito.
  const silencioLongo = ate !== null && ate.getTime() - Date.now() > 365 * 86_400_000

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        {gatilho ?? (
          <button
            type="button"
            aria-label={ate === null ? rotulo : `${rotulo} (silenciado)`}
            title={rotulo}
            className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted
                       hover:bg-bg-hover hover:text-fg data-[state=open]:bg-bg-hover"
          >
            {ate === null
              ? <Bell aria-hidden="true" strokeWidth={1.75} className="size-4" />
              : <BellOff aria-hidden="true" strokeWidth={1.75} className="size-4 text-accent" />}
          </button>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-60 rounded-lg border border-border bg-bg-raised p-1 shadow-popover"
        >
          <Menu.Label className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {rotulo}
          </Menu.Label>

          {ate !== null ? (
            <Menu.Item className={ITEM} onSelect={() => { void gravar({ mutedUntil: null }) }}>
              <Bell aria-hidden="true" className="size-4 text-fg-muted" />
              <span className="flex flex-col">
                Reativar
                <span className="text-xs text-fg-muted">
                  {silencioLongo ? 'Silenciado até você reativar' : `Silenciado até ${QUANDO.format(ate)}`}
                </span>
              </span>
            </Menu.Item>
          ) : (
            <Menu.Sub>
              <Menu.SubTrigger className={cn(ITEM, 'data-[state=open]:bg-bg-hover')}>
                <BellOff aria-hidden="true" className="size-4 text-fg-muted" />
                Silenciar
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent
                  sideOffset={4}
                  className="z-50 min-w-44 rounded-lg border border-border bg-bg-raised p-1 shadow-popover"
                >
                  {DURACOES_DE_SILENCIO.map(d => (
                    <Menu.Item
                      key={d.rotulo}
                      className={ITEM}
                      onSelect={() => { void gravar({ mutedUntil: prazoDoSilencio(d.minutos) }) }}
                    >
                      {d.rotulo}
                    </Menu.Item>
                  ))}
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
          )}

          <Menu.Separator className="my-1 h-px bg-border-subtle" />
          <Menu.RadioGroup
            value={proprio ?? 'herdar'}
            onValueChange={v => { void gravar({ level: v === 'herdar' ? null : v as NivelDeNotificacao }) }}
          >
            {(
              <Menu.RadioItem value="herdar" className={ITEM}>
                <span className="flex w-4 justify-center">
                  <Menu.ItemIndicator><Check aria-hidden="true" className="size-4" /></Menu.ItemIndicator>
                </span>
                <span className="flex flex-col">
                  {scopeType === 'channel' ? 'Como o grupo' : 'Padrão'}
                  <span className="text-xs text-fg-muted">{ROTULO_DO_NIVEL[herdado]}</span>
                </span>
              </Menu.RadioItem>
            )}
            {NIVEIS.map(n => (
              <Menu.RadioItem key={n} value={n} className={ITEM}>
                <span className="flex w-4 justify-center">
                  <Menu.ItemIndicator><Check aria-hidden="true" className="size-4" /></Menu.ItemIndicator>
                </span>
                {ROTULO_DO_NIVEL[n]}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
