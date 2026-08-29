import { createHmac } from 'node:crypto'

/**
 * Token de acesso ao LiveKit.
 *
 * Aqui JWT e a escolha certa, e e o unico lugar do sistema onde ele aparece: o
 * escopo e estreito (uma sala, uma pessoa) e a validade e de cinco minutos, o
 * que torna a revogacao desnecessaria — spec 03 secao 4. A sessao continua
 * vivendo no banco, onde um DELETE encerra o acesso no mesmo instante.
 *
 * O token autoriza apenas a ENTRADA. Depois que a conexao de midia esta de pe,
 * ela nao e reavaliada por este token: quem for removido do canal no meio de
 * uma chamada e desconectado pelo evento de saida, nao pela expiracao.
 */
export const VALIDADE_DO_TOKEN_S = 5 * 60

export type Concessao = {
  /** A sala e o canal. Um canal, uma sala, sempre — sem mapa a manter. */
  sala: string
  usuario: string
  nomeExibido: string
  /** Qualquer participante transmite; quem nao pode publicar so escuta. */
  podePublicar: boolean
  /** Silenciar e desconectar terceiros. Vem de `channel.moderate_call`. */
  moderador: boolean
}

function base64url(valor: Buffer | string): string {
  return Buffer.from(valor).toString('base64url')
}

/**
 * Recebe chave, segredo e relogio em vez de le-los do ambiente: e o que torna
 * a assinatura verificavel por teste sem subir processo nem servidor.
 */
export function assinarTokenDeMidia(
  concessao: Concessao,
  chave: string,
  segredo: string,
  agoraMs: number = Date.now(),
): string {
  const agora = Math.floor(agoraMs / 1000)
  const cabecalho = { alg: 'HS256', typ: 'JWT' }
  const corpo = {
    iss: chave,
    sub: concessao.usuario,
    name: concessao.nomeExibido,
    nbf: agora,
    exp: agora + VALIDADE_DO_TOKEN_S,
    video: {
      room: concessao.sala,
      roomJoin: true,
      canSubscribe: true,
      canPublish: concessao.podePublicar,
      // Dados por canal de midia ficam desligados: o tempo real do sistema
      // passa pelo WebSocket da propria API, onde o fan-out ja decide quem
      // pode ouvir o que. Dois caminhos para a mesma informacao seriam duas
      // chances de vazar.
      canPublishData: false,
      roomAdmin: concessao.moderador,
    },
  }

  const semAssinatura = `${base64url(JSON.stringify(cabecalho))}.${base64url(JSON.stringify(corpo))}`
  const assinatura = createHmac('sha256', segredo).update(semAssinatura).digest('base64url')
  return `${semAssinatura}.${assinatura}`
}

export type ConfiguracaoDeMidia = { chave: string; segredo: string; url: string }

/**
 * As tres variaveis, ou nada. Meia configuracao — chave sem segredo, segredo
 * sem URL — nao e um servidor de midia pela metade: e um 503 honesto, e por
 * isso a checagem devolve null em vez de tentar assinar com o que tem.
 */
export function configuracaoDeMidia(bruto: {
  chave?: string | undefined; segredo?: string | undefined; url?: string | undefined
}): ConfiguracaoDeMidia | null {
  const { chave, segredo, url } = bruto
  if (!chave || !segredo || !url) return null
  return { chave, segredo, url }
}
