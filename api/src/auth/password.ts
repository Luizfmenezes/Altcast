import { hash, verify } from '@node-rs/argon2'
import type { Algorithm } from '@node-rs/argon2'
import { readFileSync } from 'node:fs'
import { AppError } from '../shared/errors.js'

/**
 * Algorithm e um `declare const enum` do @node-rs/argon2: nao existe em runtime
 * (o objeto exportado vem vazio) e verbatimModuleSyntax proibe TS de inlina-lo.
 * O valor literal 2 e Argon2id, conforme index.d.ts do pacote. Escrever o
 * numero e explicito; usar Algorithm.Argon2id passaria undefined e so
 * funcionaria por coincidir com o padrao da biblioteca.
 */
const ARGON2ID: Algorithm = 2

/** Parametros OWASP, conforme a spec 03: 19 MiB, 2 iteracoes, paralelismo 1. */
const OPTS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

const COMUNS = new Set(
  readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim()).filter(Boolean),
)

/**
 * Hash argon2id REAL de um segredo aleatorio descartado.
 *
 * Precisa ser valido de verdade. O login verifica contra ele quando o e-mail
 * nao existe, para que a resposta custe o mesmo tempo de uma senha errada. Um
 * hash sintetico falharia a parsear em microssegundos, e a diferenca de tempo
 * voltaria a entregar quem tem conta — que e exatamente o vazamento que a
 * spec 03 secao 5 manda fechar.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$/PHAeMMnuEqdueuuzzZPJA$9w2Gz4lKPR6wY702wVORHjFEKlSIOQgx0V6m3U8CLi8'

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTS)
  } catch {
    return false
  }
}

/** Sem exigencia de simbolos: regras de composicao reduzem entropia na pratica,
 *  empurrando todo mundo para variacoes de 'Senha@123'. Comprimento minimo mais
 *  lista de vazadas protege melhor. */
export function assertPasswordAcceptable(plain: string): void {
  const problemas: string[] = []
  if (plain.length < 10) problemas.push('A senha precisa ter ao menos 10 caracteres.')
  if (COMUNS.has(plain)) problemas.push('Esta senha aparece em vazamentos conhecidos. Escolha outra.')
  if (problemas.length) throw new AppError('validation_failed', { password: problemas })
}
