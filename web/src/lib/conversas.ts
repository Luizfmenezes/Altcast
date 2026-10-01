import { api } from './api.js'
import { ehConversa, useStore } from './store.js'
import type { Membro } from './tipos.js'

/**
 * Abre a conversa com alguem — criando-a, se for a primeira vez.
 *
 * O servidor e idempotente (indice unico do par), entao clicar duas vezes em
 * "Mensagem" nunca cria duas conversas. Conversa NOVA chega pelo evento
 * `group.created`, que ja puxa a tela para ela; conversa que ja existia so
 * precisa ser escolhida.
 */
export async function abrirConversaCom(userId: string): Promise<void> {
  const r = await api.post<{ groupId: string; channelId: string | null }>('/dms', { userId })
  const estado = useStore.getState()
  if (estado.groups.some(g => g.id === r.groupId)) estado.escolherGrupo(r.groupId)
}

/** Fecha da minha lista. A conversa continua existindo para os dois. */
export async function fecharConversa(groupId: string): Promise<void> {
  await api.delete(`/dms/${groupId}`)
  // O evento `dm.hidden` chega a todas as minhas abas; aplicar ja aqui evita
  // a linha piscar ate ele chegar.
  useStore.getState().aplicarEvento({ t: 'dm.hidden', d: { groupId } })
}

/**
 * Com quem posso abrir conversa: quem divide comigo um GRUPO — a mesma
 * fronteira que o servidor confere. Uma linha por pessoa, em ordem de nome.
 */
export function pessoasAlcancaveis(
  estado: { members: readonly Membro[]; groups: readonly { id: string; kind?: 'group' | 'dm' }[]; user: { id: string } | null },
): Membro[] {
  const grupos = new Set(estado.groups.filter(g => !ehConversa(g)).map(g => g.id))
  const vistas = new Map<string, Membro>()
  for (const m of estado.members) {
    if (!grupos.has(m.groupId) || m.userId === estado.user?.id) continue
    if (!vistas.has(m.userId)) vistas.set(m.userId, m)
  }
  return [...vistas.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
}
