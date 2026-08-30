import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Junta classes do Tailwind resolvendo conflitos pelo ultimo valor.
 *
 * `clsx` sozinho concatena: `px-2` e `px-4` sobreviveriam os dois, e quem
 * vence passaria a depender da ordem em que o Tailwind emitiu as regras — algo
 * que nenhum componente controla. `twMerge` desempata pelo que veio por
 * ultimo, que e o que quem escreve a chamada espera.
 */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas))
}
