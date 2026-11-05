import type { PedidoDeAtividade } from './ponte'

/**
 * O cartao do Discord, montado AQUI e nao na pagina.
 *
 * Tudo que chega pela ponte e entrada de conteudo remoto. Este modulo e a
 * alfandega: confere cada campo, escreve o texto ele mesmo e so deixa passar um
 * link que aponte para a tela de pedir para assistir do proprio Altcast. Sem
 * isso, um script qualquer na pagina poria no perfil de quem usa o app um botao
 * para onde bem entendesse.
 *
 * Nao importa nada do Electron, e e por isso que da para testar.
 */

/** O formato que o `SET_ACTIVITY` do Discord le. */
export type AtividadeDoDiscord = {
  /** 0 e "Jogando": o unico tipo que o RPC aceita sem URL de Twitch ou YouTube. */
  type: 0
  details: string
  state?: string
  timestamps: { start: number }
  assets: { large_image: string; large_text: string }
  buttons?: Array<{ label: string; url: string }>
  instance: false
}

export type AtividadeMontada = { clientId: string; atividade: AtividadeDoDiscord }

/** Snowflake do Discord: so digitos, 17 a 20 deles. */
const CLIENT_ID = /^\d{17,20}$/

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CAMINHO_DE_ASSISTIR = new RegExp(`^/assistir/${UUID}/${UUID}$`)

/**
 * O Discord recusa o `SET_ACTIVITY` inteiro quando `state` tem menos de 2 ou mais
 * de 128 caracteres. Recusa, e nao corta: um grupo chamado "A" apagaria o cartao
 * em vez de so ficar sem nome.
 */
const MAXIMO_DE_TEXTO = 128

function textoDoGrupo(bruto: unknown): string | undefined {
  if (typeof bruto !== 'string') return undefined
  const limpo = bruto.trim()
  if ([...limpo].length < 2) return undefined
  const letras = [...limpo]
  return letras.length <= MAXIMO_DE_TEXTO
    ? limpo
    : `${letras.slice(0, MAXIMO_DE_TEXTO - 1).join('')}…`
}

/** O link so passa se for a tela de assistir DESTA origem. */
function linkSeguro(bruto: unknown, origem: string): string | null {
  if (typeof bruto !== 'string') return null
  try {
    const url = new URL(bruto)
    if (url.origin !== origem) return null
    if (!CAMINHO_DE_ASSISTIR.test(url.pathname)) return null
    if (url.search !== '' || url.hash !== '') return null
    return url.href
  } catch {
    return null
  }
}

/**
 * Converte o pedido da pagina no cartao. `null` quando o pedido nao presta —
 * e nesse caso o certo e nao mostrar nada, em vez de um cartao pela metade.
 */
export function montarAtividade(
  bruto: unknown, origem: string, agora: number = Date.now(),
): AtividadeMontada | null {
  if (typeof bruto !== 'object' || bruto === null) return null
  const p = bruto as Partial<Record<keyof PedidoDeAtividade, unknown>>

  if (typeof p.clientId !== 'string' || !CLIENT_ID.test(p.clientId)) return null
  if (p.estado !== 'chamada' && p.estado !== 'transmitindo') return null
  if (typeof p.desde !== 'number' || !Number.isFinite(p.desde) || p.desde <= 0) return null

  const transmitindo = p.estado === 'transmitindo'
  const grupo = textoDoGrupo(p.grupo)
  // O botao e so da transmissao. Em chamada sem tela nao ha o que assistir, e
  // um "Assistir" que leva a uma sala sem video seria uma promessa vazia.
  const link = transmitindo ? linkSeguro(p.linkParaAssistir, origem) : null

  return {
    clientId: p.clientId,
    atividade: {
      type: 0,
      details: transmitindo ? 'Transmitindo a tela' : 'Em chamada',
      ...(grupo === undefined ? {} : { state: grupo }),
      // Um relogio adiantado no PC nao pode fazer o Discord mostrar "ha -3:00".
      timestamps: { start: Math.min(Math.floor(p.desde), agora) },
      assets: {
        // URL externa, e nao chave de asset: o logo vem do proprio servidor e
        // a Application no Discord nao precisa de upload de arte nenhuma.
        large_image: `${origem}/android-chrome-512x512.png`,
        large_text: 'Altcast',
      },
      ...(link === null ? {} : { buttons: [{ label: 'Assistir no Altcast', url: link }] }),
      instance: false,
    },
  }
}
