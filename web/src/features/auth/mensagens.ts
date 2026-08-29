/**
 * Traducao de codigo para texto.
 *
 * O servidor manda `code` estavel e mensagem pronta; a previa de convite e a
 * excecao, porque devolve um `reason` cru dentro de uma resposta 200. Quem le a
 * tela nao deve encontrar `invite_expired` em lugar nenhum.
 */
export const MOTIVO_DO_CONVITE: Record<string, string> = {
  not_found: 'Convite inexistente.',
  expired: 'Este convite expirou.',
  revoked: 'Este convite foi revogado.',
  max_uses_reached: 'Este convite atingiu o limite de usos.',
}

export function textoDoMotivo(motivo: string): string {
  return MOTIVO_DO_CONVITE[motivo] ?? 'Este convite nao pode ser usado.'
}

/** Plural sem malabarismo: dois casos, e so isso existe. */
export function contagemDeMembros(n: number): string {
  return n === 1 ? '1 membro' : `${n} membros`
}
