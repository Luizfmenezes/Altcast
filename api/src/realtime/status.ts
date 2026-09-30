import { presence, type StatusEscolhido, type StatusVisivel } from './presence.js'
import { emit } from './emit.js'

/**
 * O status escolhido que ainda vale.
 *
 * "Nao perturbe por 1 hora" vence sozinho: sem job nenhum, quem le depois do
 * prazo simplesmente enxerga `online`. O banco guarda a escolha e o prazo; a
 * leitura decide se o prazo ja passou.
 */
export function statusEfetivo(
  escolhido: StatusEscolhido | null | undefined, expiraEm: Date | null | undefined,
  agora: Date = new Date(),
): StatusEscolhido {
  if (escolhido === null || escolhido === undefined) return 'online'
  if (expiraEm !== null && expiraEm !== undefined && expiraEm <= agora) return 'online'
  return escolhido
}

/**
 * Avisa os pares so quando o status VISIVEL mudou.
 *
 * Trocar de `online` para `invisible` e, para os outros, ficar `offline` — e
 * so isso que eles recebem. Trocar de `invisible` para `dnd` estando
 * conectado aparece para eles como uma chegada. O texto do status vai junto
 * so quando a pessoa esta visivel: o invisivel nao anuncia frase nenhuma.
 */
export function anunciarSeMudou(
  userId: string, antes: StatusVisivel,
  texto?: { statusText: string | null; statusEmoji: string | null },
): void {
  const depois = presence.visivel(userId)
  if (depois === antes && texto === undefined) return
  void emit.toPeersOf(userId, {
    t: 'presence.update',
    d: {
      userId,
      status: depois,
      ...(texto === undefined || depois === 'offline' ? {} : texto),
    },
  })
}
