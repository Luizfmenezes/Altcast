// Monta um .ico multi-camada a partir de um PNG grande, usando sharp.
// O .ico e um cabecalho de 6 bytes, um diretorio de 16 bytes por camada, e as
// imagens em seguida. Camadas em PNG (aceito pelo Windows desde o Vista) em
// vez de BMP: e o que o proprio Windows usa para a de 256, e evita ter de
// escrever duas codificacoes diferentes no mesmo arquivo.
const sharp = require('sharp')
const fs = require('node:fs')

const ORIGEM = process.argv[2]
const DESTINO = process.argv[3]
const TAMANHOS = [16, 24, 32, 48, 64, 128, 256]

;(async () => {
  const imagens = []
  for (const t of TAMANHOS) {
    imagens.push({
      tamanho: t,
      dados: await sharp(ORIGEM)
        .resize(t, t, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    })
  }

  const cabecalho = Buffer.alloc(6)
  cabecalho.writeUInt16LE(0, 0)                 // reservado
  cabecalho.writeUInt16LE(1, 2)                 // tipo 1 = icone
  cabecalho.writeUInt16LE(imagens.length, 4)

  const diretorio = Buffer.alloc(16 * imagens.length)
  let deslocamento = cabecalho.length + diretorio.length

  imagens.forEach((img, i) => {
    const o = i * 16
    // 0 significa 256: o campo tem um byte so, e 256 nao cabe nele.
    diretorio.writeUInt8(img.tamanho === 256 ? 0 : img.tamanho, o)
    diretorio.writeUInt8(img.tamanho === 256 ? 0 : img.tamanho, o + 1)
    diretorio.writeUInt8(0, o + 2)              // cores da paleta
    diretorio.writeUInt8(0, o + 3)              // reservado
    diretorio.writeUInt16LE(1, o + 4)           // planos
    diretorio.writeUInt16LE(32, o + 6)          // bits por pixel
    diretorio.writeUInt32LE(img.dados.length, o + 8)
    diretorio.writeUInt32LE(deslocamento, o + 12)
    deslocamento += img.dados.length
  })

  fs.writeFileSync(DESTINO, Buffer.concat([cabecalho, diretorio, ...imagens.map(i => i.dados)]))
  console.log('gerado:', DESTINO)
  imagens.forEach(i => { console.log(`  ${i.tamanho}x${i.tamanho}  ${i.dados.length} bytes`) })
})().catch(e => { console.error(e); process.exit(1) })
