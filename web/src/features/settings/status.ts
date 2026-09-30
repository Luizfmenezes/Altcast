import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import type { StatusEscolhido } from '../../lib/tipos.js'

export const ROTULO_DO_STATUS: Record<StatusEscolhido, { nome: string; descricao: string }> = {
  online: { nome: 'Online', descricao: 'Ausente sozinho depois de 10 min sem uso' },
  idle: { nome: 'Ausente', descricao: 'Aparece ausente até você mudar' },
  dnd: { nome: 'Não perturbe', descricao: 'Sem som e sem aviso; as contagens continuam' },
  invisible: { nome: 'Invisível', descricao: 'Aparece offline, mas você usa tudo normalmente' },
}

/** Os prazos da frase de status, em minutos. `null` e "nao limpar". */
export const PRAZOS_DO_STATUS: readonly { rotulo: string; minutos: number | null }[] = [
  { rotulo: 'Não limpar', minutos: null },
  { rotulo: '30 minutos', minutos: 30 },
  { rotulo: '1 hora', minutos: 60 },
  { rotulo: '4 horas', minutos: 240 },
  { rotulo: 'Hoje', minutos: -1 },
]

/** "Hoje" termina a meia-noite local, e nao em 24 horas. */
export function prazoDoStatus(minutos: number | null, agora: Date = new Date()): string | null {
  if (minutos === null) return null
  if (minutos === -1) {
    const fim = new Date(agora)
    fim.setHours(23, 59, 59, 999)
    return fim.toISOString()
  }
  return new Date(agora.getTime() + minutos * 60_000).toISOString()
}

/**
 * Grava o status e aplica a resposta na hora, pelo mesmo redutor do evento
 * `user.status` — a tela nao espera o socket para mostrar a escolha.
 */
export async function definirStatus(corpo: {
  status: StatusEscolhido
  text?: string | null
  emoji?: string | null
  expiresAt?: string | null
}): Promise<void> {
  const r = await api.put<{
    status: StatusEscolhido; statusText: string | null; statusEmoji: string | null
    statusExpiresAt: string | null
  }>('/auth/me/status', corpo)
  useStore.getState().aplicarEvento({ t: 'user.status', d: r })
}
