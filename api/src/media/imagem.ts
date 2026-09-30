import sharp from 'sharp'
import { detectarTipo } from './tipos.js'
import { AppError } from '../shared/errors.js'

/**
 * Transforma o que a pessoa mandou numa imagem de perfil.
 *
 * Avatar e icone de grupo sao lidos por TODO mundo que compartilha um grupo
 * com voce, em toda lista de membros e em toda mensagem. Guardar o arquivo
 * original faria a barra lateral baixar seis megabytes por pessoa.
 */

/** Oito, e nao os 25 dos anexos: a saida tem ~15 KB, e o resto e so decode. */
export const LIMITE_DE_IMAGEM = 8 * 1024 * 1024

export const LADO_DO_AVATAR = 256
export const LADO_DO_ICONE = 512
/** O banner do perfil: 5:2, o formato do topo do cartao. */
export const BANNER = { largura: 960, altura: 384 } as const

const ACEITOS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * Redimensiona, recorta e recodifica. Sempre `image/webp`.
 *
 * Tres decisoes valem registro:
 *
 * 1. O tipo sai dos BYTES, e nao do que o cliente declarou — mesma regra do
 *    anexo. O `Content-Type` e texto que o remetente escolhe.
 * 2. `fit: 'cover'`, e nao `inside` como a miniatura de anexo usa. Avatar e
 *    desenhado dentro de um circulo: encaixar uma foto 16:9 inteira ali
 *    deixaria duas tarjas e pareceria defeito.
 * 3. Animacao e DESCARTADA (sharp sem `animated` pega o primeiro quadro). Um
 *    GIF de duzentos quadros e duzentos decodes por upload — amplificacao de
 *    CPU barata de disparar e cara de servir — e a saida precisa ser um blob
 *    unico, de tamanho conhecido.
 */
export async function normalizarImagem(
  dados: Buffer, lado: number, altura: number = lado,
): Promise<Buffer> {
  const tipo = detectarTipo(dados)
  if (!ACEITOS.has(tipo)) throw new AppError('unsupported_image')

  try {
    return await sharp(dados)
      .resize(lado, altura, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    // Assinatura valida e conteudo quebrado depois dela. Do ponto de vista de
    // quem enviou e a mesma coisa: esta imagem nao serve.
    throw new AppError('unsupported_image')
  }
}
