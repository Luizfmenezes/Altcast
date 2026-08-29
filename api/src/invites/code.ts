import { randomBytes } from 'node:crypto'

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'  // Crockford: sem I, L, O, U

/**
 * randomBytes, jamais Math.random: um gerador previsivel transformaria o
 * codigo de convite em algo adivinhavel.
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALFABETO[bytes[i]! % ALFABETO.length]
  return out
}

/**
 * O codigo circula ditado por telefone e no WhatsApp. A normalizacao — e a
 * escolha do alfabeto, e a fonte monoespacada da interface (spec 05) — servem
 * todas a mesma finalidade: quem digitou I no lugar de 1 ainda entra.
 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .trim().toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}
