import { describe, it, expect } from 'vitest'
import { detectarTipo, ehReproduzivel, OCTETOS } from '../src/media/tipos.js'

/** Monta um buffer com a assinatura no comeco e lixo no resto. */
function comAssinatura(bytes: number[], tamanho = 64): Buffer {
  const b = Buffer.alloc(tamanho)
  Buffer.from(bytes).copy(b)
  return b
}

describe('deteccao de tipo por magic bytes', () => {
  it('reconhece as imagens que a conversa exibe', () => {
    expect(detectarTipo(comAssinatura([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectarTipo(comAssinatura([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toBe('image/png')
    expect(detectarTipo(Buffer.from('GIF89a' + 'x'.repeat(40)))).toBe('image/gif')
  })

  it('reconhece webp, que so se distingue no oitavo byte', () => {
    const webp = Buffer.alloc(64)
    webp.write('RIFF', 0)
    webp.write('WEBP', 8)
    expect(detectarTipo(webp)).toBe('image/webp')
  })

  it('nao confunde webp com wav: os dois comecam em RIFF', () => {
    const wav = Buffer.alloc(64)
    wav.write('RIFF', 0)
    wav.write('WAVE', 8)
    expect(detectarTipo(wav)).toBe('audio/wav')
  })

  it('reconhece mp4 pela caixa ftyp, que nao fica no byte zero', () => {
    const mp4 = Buffer.alloc(64)
    mp4.write('ftyp', 4)
    mp4.write('isom', 8)
    expect(detectarTipo(mp4)).toBe('video/mp4')
  })

  it('reconhece pdf, zip e os audios soltos', () => {
    expect(detectarTipo(Buffer.from('%PDF-1.7' + 'x'.repeat(40)))).toBe('application/pdf')
    expect(detectarTipo(comAssinatura([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip')
    expect(detectarTipo(Buffer.from('ID3' + 'x'.repeat(40)))).toBe('audio/mpeg')
    expect(detectarTipo(Buffer.from('OggS' + 'x'.repeat(40)))).toBe('audio/ogg')
  })

  /**
   * O ponto inteiro da deteccao no servidor: um executavel renomeado para
   * .png nao vira imagem so porque o cliente disse que era.
   */
  it('arquivo desconhecido vira octetos, nunca o que o cliente declarou', () => {
    expect(detectarTipo(comAssinatura([0x4d, 0x5a, 0x90, 0x00]))).toBe(OCTETOS)
    expect(detectarTipo(Buffer.from('texto qualquer sem assinatura'))).toBe(OCTETOS)
    expect(detectarTipo(Buffer.alloc(0))).toBe(OCTETOS)
  })

  /**
   * SVG e documento executavel, nao imagem: exibido em <img> de origem
   * propria, ele roda script no contexto do site. Nao ter assinatura binaria
   * ja o joga em octetos, e e assim que deve continuar.
   */
  it('SVG nunca vira image/svg+xml', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(detectarTipo(svg)).toBe(OCTETOS)
  })

  it('HTML disfarcado de imagem tambem cai em octetos', () => {
    expect(detectarTipo(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBe(OCTETOS)
  })
})

describe('o que o navegador pode reproduzir na propria conversa', () => {
  it('imagem, video e audio reconhecidos sao exibidos', () => {
    expect(ehReproduzivel('image/png')).toBe(true)
    expect(ehReproduzivel('video/mp4')).toBe(true)
    expect(ehReproduzivel('audio/mpeg')).toBe(true)
  })

  it('todo o resto e download, nunca renderizacao', () => {
    expect(ehReproduzivel('application/pdf')).toBe(false)
    expect(ehReproduzivel('application/zip')).toBe(false)
    expect(ehReproduzivel(OCTETOS)).toBe(false)
    // A lista e de permissao, e nao de negacao: um tipo que ninguem previu
    // nasce como download, e nao como conteudo renderizado.
    expect(ehReproduzivel('image/svg+xml')).toBe(false)
    expect(ehReproduzivel('text/html')).toBe(false)
  })
})
