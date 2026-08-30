import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Tokens de uso unico que viajam por e-mail.
 *
 * Nao reaproveitam `generateInviteCode()` de proposito. Aquele codigo tem oito
 * caracteres em base32 porque precisa ser ditado por telefone sem erro, e para
 * um convite isso basta: o pior caso de um convite adivinhado e um estranho
 * dentro de um grupo, que da para expulsar. O pior caso de um token de
 * recuperacao adivinhado e a conta perdida. Sao 256 bits e nao se dita nenhum.
 */
const BYTES = 32

/** Uma hora. Tempo de sair do e-mail, ler e voltar — nao de esquecer aberto. */
export const VALIDADE_RESET_MS = 60 * 60 * 1000

/** Vinte e quatro horas: confirmar endereco pode esperar o dia seguinte. */
export const VALIDADE_VERIFICACAO_MS = 24 * 60 * 60 * 1000

export type TokenEmitido = {
  /** Vai no link do e-mail. Nunca e gravado. */
  token: string
  /** Vai para o banco. Nunca sai dele. */
  hash: string
  expiraEm: Date
}

export function emitirToken(validadeMs: number): TokenEmitido {
  const token = randomBytes(BYTES).toString('base64url')
  return {
    token,
    hash: hashDoToken(token),
    expiraEm: new Date(Date.now() + validadeMs),
  }
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Comparacao em tempo constante.
 *
 * A busca no banco e por chave primaria e ja seria dificil de cronometrar, mas
 * o custo disto e um punhado de microssegundos e o custo de errar e um oraculo
 * que revela o token um caractere por vez. Aceita o barato.
 */
export function tokensIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  // timingSafeEqual exige o mesmo tamanho; comprimentos diferentes ja sao
  // publicamente distinguiveis pelo formato, entao sair aqui nao vaza nada.
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}
