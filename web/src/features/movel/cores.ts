/**
 * Os tons do celular.
 *
 * No desktop o Altcast e uma ferramenta de trabalho — o acento azul aparece
 * com parcimonia e a superficie e neutra. No celular, a pedido do dono do
 * produto, a casa ganha cartoes pasteis grandes e redondos: e o que da
 * personalidade a uma tela de 390px sem empilhar enfeite.
 *
 * Pastel e SEMPRE com tinta escura, nos dois temas: e o contraste que faz o
 * cartao pastel saltar do fundo escuro (e continuar legivel no claro). Todos
 * os pares abaixo passam de 12:1 com `TINTA`, conferidos em `movel.test.ts`.
 */
export const TINTA = '#0b0f19'
/** A tinta secundaria sobre pastel: o "sobrenome" do cartao. 7:1 no pior caso. */
export const TINTA_SUAVE = '#334155'

export const PASTEIS = [
  '#c7dbff', // azul — o da marca, e o do cartao principal
  '#d9f99d', // lima
  '#fde68a', // ambar claro
  '#fbcfe8', // rosa
  '#ddd6fe', // lavanda
  '#bbf7d0', // menta
] as const

/** O pastel de um grupo: estavel por id, para o cartao nao trocar de cor a cada visita. */
export function pastelDe(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PASTEIS[h % PASTEIS.length]!
}
