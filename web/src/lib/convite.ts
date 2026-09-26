/**
 * Le um convite do que a pessoa colou.
 *
 * Aceita a URL inteira (`https://altcast.exemplo/convite/K7M2P9XQ`) ou so o
 * codigo, porque quem recebe um convite recebe um LINK — pedir que ela extraia
 * oito caracteres dele seria transferir a ela um trabalho que o codigo faz
 * melhor e sem errar.
 *
 * A normalizacao e a mesma de `api/src/invites/code.ts`, e pelo mesmo motivo:
 * o alfabeto e base32 de Crockford, escolhido para o codigo ser ditavel por
 * telefone. `I` e `L` viram `1`, `O` vira `0`. Fazer isto aqui tambem evita
 * uma ida ao servidor so para descobrir que a pessoa digitou a letra O.
 *
 * Devolve `null` quando nao ha codigo plausivel — e e isso que mantem o botao
 * desabilitado em vez de mandar a pessoa para uma pagina de erro.
 */

const TAMANHO = 8
const ALFABETO = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

export function normalizarCodigoDeConvite(bruto: string): string | null {
  // O ultimo segmento nao-vazio: funciona para a URL com e sem barra final, e
  // para o codigo solto, sem precisar saber qual dos dois chegou.
  const pedacos = bruto.trim().split(/[/?#]/).filter(p => p !== '')
  const candidato = pedacos[pedacos.length - 1] ?? ''

  const limpo = candidato
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')

  if (limpo.length !== TAMANHO) return null
  return ALFABETO.test(limpo) ? limpo : null
}
