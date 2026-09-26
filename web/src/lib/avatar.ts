/**
 * O recorte da foto de perfil, antes de ela sair daqui.
 *
 * O servidor tambem redimensiona — e precisa, porque nunca se confia no
 * cliente. Fazer isto aqui tambem serve a outra coisa: uma foto de celular
 * tem seis megabytes, e subir seis megabytes para o servidor devolver quinze
 * kilobytes gasta a banda de quem esta num plano ruim e faz a barra de
 * progresso existir. Recortada antes, a subida e instantanea.
 */

export const LADO_DO_AVATAR = 256

/**
 * Corta o centro num quadrado e reduz para `lado`.
 *
 * Centro, e nao topo: quase toda foto de perfil tem o rosto no meio, e cortar
 * pelo topo decapita paisagens deitadas. Um editor de recorte de verdade seria
 * melhor, e e o passo seguinte — nao o primeiro.
 *
 * Devolve `null` quando o navegador nao entrega canvas (ou o arquivo nao e
 * imagem): quem chama sobe o original e deixa o servidor decidir.
 */
export async function recortarQuadrado(
  arquivo: File, lado = LADO_DO_AVATAR,
): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(arquivo)
  } catch {
    return null
  }

  try {
    const corte = Math.min(bitmap.width, bitmap.height)
    const x = (bitmap.width - corte) / 2
    const y = (bitmap.height - corte) / 2

    const tela = document.createElement('canvas')
    tela.width = lado
    tela.height = lado
    const pincel = tela.getContext('2d')
    if (pincel === null) return null

    pincel.drawImage(bitmap, x, y, corte, corte, 0, 0, lado, lado)

    return await new Promise<Blob | null>(resolver => {
      // WebP com fallback para JPEG: `toBlob` devolve PNG quando o tipo pedido
      // nao existe, e PNG de uma foto e varias vezes maior. O servidor
      // recodifica para webp de qualquer jeito.
      tela.toBlob(b => resolver(b), 'image/webp', 0.9)
    })
  } finally {
    bitmap.close()
  }
}
