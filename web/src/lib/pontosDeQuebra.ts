import { useEffect, useState } from 'react'

/**
 * Pontos de quebra da spec 05 secao 3. Ficam em TypeScript, e nao apenas em
 * CSS, porque em telas estreitas a lista de canais nao muda de aparencia: ela
 * deixa de existir na arvore e reaparece dentro de uma gaveta. Esconder por
 * CSS manteria os canais no DOM, e o leitor de tela continuaria anunciando uma
 * navegacao que ninguem pode ver.
 */
/**
 * Da tabela da spec 05 secao 3: de 640 a 899px a lista de canais ja e gaveta,
 * entao ela so fica fixa a partir de 900. O painel de membros aguenta ate
 * 1199 e colapsa abaixo de 1200.
 */
export const LARGURA_CANAIS_FIXOS = 900
export const LARGURA_MEMBROS_FIXOS = 1200

/**
 * A partir daqui o chat cabe AO LADO da transmissao; abaixo, ele vira uma aba
 * sobre ela.
 *
 * Nao esta na tabela da spec 05 porque canal de voz nao tinha conversa quando
 * ela foi escrita. O numero sai da conta que ele precisa fechar: a coluna de
 * conversa ja perde 64px da barra de grupos e ate 240px da lista de canais, e
 * o chat pede 320. Dividir o que sobra abaixo de mil pixels entregaria um
 * video pequeno demais para ler e um chat estreito demais para conversar — os
 * dois piores, em vez de um bom.
 */
export const LARGURA_CHAT_NA_CHAMADA = 1000

export function usaLarguraMinima(px: number): boolean {
  const consulta = `(min-width: ${px}px)`
  const medir = (): boolean =>
    typeof matchMedia === 'function' ? matchMedia(consulta).matches : true

  const [combina, setCombina] = useState(medir)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(consulta)
    const aoMudar = (): void => setCombina(mq.matches)
    setCombina(mq.matches)
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [consulta])

  return combina
}
