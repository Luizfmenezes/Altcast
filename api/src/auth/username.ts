/**
 * O nome de usuario: as regras, e nada alem delas.
 *
 * Puro de proposito. Fica sob `auth/**`, onde o limiar de cobertura e 95% — e
 * uma funcao sem banco nem servidor torna esse limiar gratuito, alem de
 * permitir uma tabela-verdade exaustiva em vez de tres casos de amostra.
 */

/** Trinta dias entre trocas. Handle que muda toda semana nao identifica. */
export const INTERVALO_DE_TROCA_MS = 30 * 24 * 60 * 60 * 1000

const FORMATO = /^[a-z0-9_.]{3,32}$/

/**
 * Palavras que ninguem pode tomar.
 *
 * A metade obvia sao papeis e a marca. A metade NAO obvia, e a que importa,
 * sao os primeiros segmentos que a propria API serve: se um dia existir uma
 * rota `/@username`, um handle chamado `groups` ou `avatars` colidiria com ela
 * — e a hora de impedir isso e antes de alguem ja ter o handle, nao depois.
 */
export const RESERVADOS: ReadonlySet<string> = new Set([
  'admin', 'administrador', 'altcast', 'suporte', 'support', 'root', 'sistema',
  'system', 'moderador', 'everyone', 'here', 'todos', 'oficial', 'equipe',
  'null', 'undefined', 'me', 'eu',
  // Os segmentos que a API ja serve.
  'api', 'auth', 'groups', 'channels', 'invites', 'invitations', 'attachments',
  'avatars', 'icons', 'banners', 'users', 'ws', 'health', 'metrics', 'entrar', 'convite',
])

/** Apara e rebaixa. O handle guardado e sempre o normalizado. */
export function normalizarUsername(bruto: string): string {
  return bruto.trim().toLowerCase()
}

/**
 * O que ha de errado com este handle, ou `null` se nao ha nada.
 *
 * Devolve motivo em vez de um booleano porque a tela precisa dizer o que
 * corrigir — "invalido" sozinho manda a pessoa adivinhar.
 */
export function problemaNoUsername(bruto: string): string | null {
  const v = normalizarUsername(bruto)

  if (v.length < 3) return 'Use ao menos 3 caracteres.'
  if (v.length > 32) return 'Use no maximo 32 caracteres.'
  if (!FORMATO.test(v)) return 'Use apenas letras minusculas, numeros, ponto e sublinhado.'
  if (v.startsWith('.') || v.startsWith('_')) return 'Nao pode comecar com ponto nem sublinhado.'
  if (v.endsWith('.') || v.endsWith('_')) return 'Nao pode terminar com ponto nem sublinhado.'
  if (v.includes('..')) return 'Nao pode ter dois pontos seguidos.'
  // So digitos ocuparia o mesmo espaco visual de um id, e um dia alguem
  // escreveria uma rota que aceita os dois e nao saberia distinguir.
  if (/^[0-9]+$/.test(v)) return 'Nao pode ser so numeros.'
  if (RESERVADOS.has(v)) return 'Este nome esta reservado.'

  return null
}
