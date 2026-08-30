/**
 * Que arquivo e este, de verdade.
 *
 * Nem a extensao nem o `Content-Type` enviado pelo cliente participam desta
 * decisao. Os dois sao texto que o remetente escolhe, e aceitar qualquer um
 * deles e o caminho conhecido para um executavel chamado `foto.png` ser
 * servido de volta como imagem — ou, pior, um documento HTML ser renderizado
 * no contexto do proprio site.
 *
 * O que decide sao os primeiros bytes do arquivo. Nao e infalivel: um formato
 * sem assinatura passa por desconhecido. Isso e deliberado — desconhecido cai
 * em `application/octet-stream`, que o navegador baixa e nunca executa.
 */

/** O tipo de quem nao foi reconhecido. Sempre baixado, jamais renderizado. */
export const OCTETOS = 'application/octet-stream'

type Assinatura = {
  tipo: string
  /** Bytes esperados. `null` em uma posicao significa "qualquer byte". */
  bytes: (number | null)[]
  /** Onde a assinatura comeca. mp4 e mov guardam a delas no byte 4. */
  offset?: number
  /**
   * Segunda condicao, quando o prefixo nao basta. RIFF e o caso classico: WAV
   * e WEBP comecam identicos e so divergem no oitavo byte.
   */
  entao?: { offset: number; texto: string }
}

const ascii = (s: string): number[] => [...s].map(c => c.charCodeAt(0))

/**
 * A ordem importa: a primeira que casar vence. As entradas com `entao`
 * precisam vir antes das que so olham o prefixo, senao o prefixo generico
 * captura o caso especifico.
 */
const ASSINATURAS: Assinatura[] = [
  { tipo: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { tipo: 'image/gif', bytes: ascii('GIF8') },
  { tipo: 'image/webp', bytes: ascii('RIFF'), entao: { offset: 8, texto: 'WEBP' } },
  { tipo: 'audio/wav', bytes: ascii('RIFF'), entao: { offset: 8, texto: 'WAVE' } },
  // A caixa `ftyp` do formato ISO base media nao fica no inicio: os quatro
  // primeiros bytes sao o tamanho dela.
  { tipo: 'video/quicktime', bytes: ascii('ftyp'), offset: 4, entao: { offset: 8, texto: 'qt  ' } },
  { tipo: 'video/mp4', bytes: ascii('ftyp'), offset: 4 },
  { tipo: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { tipo: 'audio/mpeg', bytes: ascii('ID3') },
  // MPEG audio sem tag ID3: o quadro comeca com onze bits ligados.
  { tipo: 'audio/mpeg', bytes: [0xff, null] },
  { tipo: 'audio/ogg', bytes: ascii('OggS') },
  { tipo: 'audio/flac', bytes: ascii('fLaC') },
  { tipo: 'application/pdf', bytes: ascii('%PDF') },
  { tipo: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
]

function casa(dados: Buffer, a: Assinatura): boolean {
  const inicio = a.offset ?? 0
  if (dados.length < inicio + a.bytes.length) return false

  for (const [i, esperado] of a.bytes.entries()) {
    if (esperado !== null && dados[inicio + i] !== esperado) return false
  }

  if (a.entao === undefined) return true
  return dados.subarray(a.entao.offset, a.entao.offset + a.entao.texto.length)
    .toString('latin1') === a.entao.texto
}

/**
 * O tipo real dos primeiros bytes, ou `application/octet-stream`.
 *
 * Nunca devolve `image/svg+xml` nem `text/html`, mesmo que o conteudo seja um
 * deles: os dois sao documentos executaveis servidos da nossa origem, e nao ha
 * versao segura de renderiza-los inline. Sem assinatura binaria, eles caem no
 * ramo desconhecido — que e exatamente onde precisam cair.
 */
export function detectarTipo(dados: Buffer): string {
  return ASSINATURAS.find(a => casa(dados, a))?.tipo ?? OCTETOS
}

/**
 * Lista de PERMISSAO, e nao de negacao.
 *
 * A diferenca decide o que acontece com um tipo que ninguem previu: numa lista
 * de negacao ele seria renderizado por esquecimento, e aqui ele nasce como
 * download. Nenhum tipo novo pode virar conteudo executado sem alguem escrever
 * o nome dele aqui de proposito.
 */
const REPRODUZIVEIS = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac',
])

export function ehReproduzivel(contentType: string): boolean {
  return REPRODUZIVEIS.has(contentType)
}

/** Tipos que geram miniatura. Video ficou de fora: exigiria ffmpeg. */
const COM_MINIATURA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function geraMiniatura(contentType: string): boolean {
  return COM_MINIATURA.has(contentType)
}
