import type {
  Canal, Membro, Mensagem, NivelDeNotificacao, PreferenciaDeNotificacao, Usuario,
} from './tipos.js'

/**
 * Quando o Altcast pode interromper alguem — a regra inteira num lugar so.
 *
 * O som, a notificacao do sistema, o numero no titulo e o destaque na lista
 * perguntam a MESMA coisa. Se cada um decidisse do seu jeito, um canal
 * silenciado ainda apitaria, ou mostraria a bolinha, ou pularia no titulo.
 *
 * As regras (Etapa 2 do super plano):
 *
 * - o nivel herda: canal -> grupo -> padrao. O padrao e `all`, e `mentions`
 *   em grupo com mais de 50 membros — a partir dai "tudo" deixa de ser uma
 *   conversa e vira um feed;
 * - silenciar (canal ou grupo) tem prazo, e dentro dele nada interrompe;
 * - mencao notifica em todo nivel, menos `none` e o silencio;
 * - "nao perturbe" corta som e notificacao, e so isso: as contagens continuam.
 */

export const LIMITE_DO_GRUPO_GRANDE = 50

type Contexto = {
  preferencias: readonly PreferenciaDeNotificacao[]
  members: readonly Membro[]
}

function preferencia(
  prefs: readonly PreferenciaDeNotificacao[], tipo: 'group' | 'channel', id: string,
): PreferenciaDeNotificacao | undefined {
  return prefs.find(p => p.scopeType === tipo && p.scopeId === id)
}

function silenciadaAgora(p: PreferenciaDeNotificacao | undefined, agora: number): boolean {
  return p?.mutedUntil != null && Date.parse(p.mutedUntil) > agora
}

/** O nivel padrao do grupo, pelo tamanho. */
export function nivelPadraoDoGrupo(ctx: Pick<Contexto, 'members'>, groupId: string): NivelDeNotificacao {
  const tamanho = ctx.members.filter(m => m.groupId === groupId).length
  return tamanho > LIMITE_DO_GRUPO_GRANDE ? 'mentions' : 'all'
}

export function nivelDoGrupo(ctx: Contexto, groupId: string): NivelDeNotificacao {
  return preferencia(ctx.preferencias, 'group', groupId)?.level ?? nivelPadraoDoGrupo(ctx, groupId)
}

export function nivelDoCanal(ctx: Contexto, canal: Pick<Canal, 'id' | 'groupId'>): NivelDeNotificacao {
  return preferencia(ctx.preferencias, 'channel', canal.id)?.level ?? nivelDoGrupo(ctx, canal.groupId)
}

/** O nivel proprio do canal, sem heranca (nulo = herda). Para a tela de escolha. */
export function nivelProprio(
  prefs: readonly PreferenciaDeNotificacao[], tipo: 'group' | 'channel', id: string,
): NivelDeNotificacao | null {
  return preferencia(prefs, tipo, id)?.level ?? null
}

/** Ate quando o escopo esta silenciado, se estiver. */
export function silenciadoAte(
  prefs: readonly PreferenciaDeNotificacao[], tipo: 'group' | 'channel', id: string,
  agora: number = Date.now(),
): Date | null {
  const p = preferencia(prefs, tipo, id)
  return silenciadaAgora(p, agora) ? new Date(p!.mutedUntil!) : null
}

/** O canal esta calado — por ele mesmo ou pelo grupo? */
export function canalSilenciado(
  ctx: Pick<Contexto, 'preferencias'>, canal: Pick<Canal, 'id' | 'groupId'>, agora: number = Date.now(),
): boolean {
  return silenciadaAgora(preferencia(ctx.preferencias, 'channel', canal.id), agora)
    || silenciadaAgora(preferencia(ctx.preferencias, 'group', canal.groupId), agora)
}

export function meMenciona(mensagem: Pick<Mensagem, 'mentions' | 'mentionsEveryone'>, eu: string | null): boolean {
  return eu !== null && (mensagem.mentionsEveryone === true || (mensagem.mentions ?? []).includes(eu))
}

export type Decisao = 'notificar' | 'calar' | 'perguntar-ao-jev'

/**
 * Esta mensagem deve interromper quem esta lendo?
 *
 * `perguntar-ao-jev` e o nivel Inteligente sem mencao: a decisao e do
 * servidor (a triagem nunca roda no cliente, a chave nunca sai de la), e ele
 * avisa por evento quando julgar que vale.
 */
export function decidir(
  ctx: Contexto & { user: Pick<Usuario, 'id' | 'status'> | null },
  canal: Pick<Canal, 'id' | 'groupId'>,
  mensagem: Pick<Mensagem, 'authorId' | 'mentions' | 'mentionsEveryone'>,
  agora: number = Date.now(),
): Decisao {
  const eu = ctx.user?.id ?? null
  if (eu === null || mensagem.authorId === eu) return 'calar'
  if (ctx.user?.status === 'dnd') return 'calar'
  if (canalSilenciado(ctx, canal, agora)) return 'calar'
  const nivel = nivelDoCanal(ctx, canal)
  if (nivel === 'none') return 'calar'
  if (meMenciona(mensagem, eu)) return 'notificar'
  if (nivel === 'all') return 'notificar'
  if (nivel === 'smart') return 'perguntar-ao-jev'
  return 'calar'
}

/** As duracoes do menu "Silenciar", em minutos. `null` e "ate eu reativar". */
export const DURACOES_DE_SILENCIO: readonly { rotulo: string; minutos: number | null }[] = [
  { rotulo: 'Por 15 minutos', minutos: 15 },
  { rotulo: 'Por 1 hora', minutos: 60 },
  { rotulo: 'Por 8 horas', minutos: 480 },
  { rotulo: 'Por 24 horas', minutos: 1440 },
  { rotulo: 'Até eu reativar', minutos: null },
]

/** "Ate eu reativar" e um prazo muito longo, e nao um estado a mais. */
export function prazoDoSilencio(minutos: number | null, agora: number = Date.now()): string {
  const DEZ_ANOS = 10 * 365 * 24 * 60
  return new Date(agora + (minutos ?? DEZ_ANOS) * 60_000).toISOString()
}

export const ROTULO_DO_NIVEL: Record<NivelDeNotificacao, string> = {
  all: 'Todas as mensagens',
  mentions: 'Só menções',
  smart: 'Inteligente',
  none: 'Nada',
}
