import type { ReactNode } from 'react'
import { Download, FileText } from 'lucide-react'
import { formatarTamanho, urlDaMiniatura, urlDoAnexo } from '../../lib/anexos.js'
import type { Anexo } from '../../lib/tipos.js'

/**
 * Os arquivos de uma mensagem.
 *
 * O que decide como cada um aparece e `contentType` e `reproduzivel`, ambos
 * vindos do SERVIDOR, que foi quem leu os bytes. O nome do arquivo nao
 * participa: um executavel chamado `foto.png` chega aqui como octetos e vira
 * cartao de download, que e o unico tratamento seguro para ele.
 */

const ehImagem = (a: Anexo): boolean => a.contentType.startsWith('image/') && a.reproduzivel
const ehVideo = (a: Anexo): boolean => a.contentType.startsWith('video/') && a.reproduzivel
const ehAudio = (a: Anexo): boolean => a.contentType.startsWith('audio/') && a.reproduzivel

/**
 * Imagem com a miniatura no lugar do original.
 *
 * Sem isto, uma conversa com dez fotos de celular baixaria dezenas de
 * megabytes so para mostrar dez quadradinhos. O original abre em aba nova, sob
 * a mesma checagem de permissao.
 */
function Imagem({ anexo }: { anexo: Anexo }): ReactNode {
  const fonte = anexo.temMiniatura ? urlDaMiniatura(anexo.id) : urlDoAnexo(anexo.id)

  return (
    <a
      href={urlDoAnexo(anexo.id)}
      target="_blank"
      rel="noreferrer"
      className="block max-w-sm overflow-hidden rounded border border-border-subtle
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <img
        src={fonte}
        // O nome do arquivo e a unica descricao que existe. Nao e boa — quem
        // manda raramente renomeia —, mas e melhor que "imagem" repetido, e o
        // leitor de tela precisa distinguir uma foto da outra.
        alt={anexo.filename}
        loading="lazy"
        // As dimensoes reais reservam o espaco antes de a imagem chegar: sem
        // elas a conversa pula sob o dedo de quem esta lendo.
        {...(anexo.width !== null && anexo.height !== null
          ? { width: anexo.width, height: anexo.height }
          : {})}
        className="h-auto w-full max-w-sm bg-bg-raised object-cover"
      />
    </a>
  )
}

/** Tudo que nao se reproduz: PDF, zip, e todo tipo que ninguem reconheceu. */
function CartaoDeDownload({ anexo }: { anexo: Anexo }): ReactNode {
  return (
    <a
      href={urlDoAnexo(anexo.id)}
      download={anexo.filename}
      className="flex max-w-sm items-center gap-3 rounded border border-border-subtle
                 bg-bg-raised px-3 py-2 text-sm text-fg hover:border-border
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <FileText aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{anexo.filename}</span>
        <span className="block font-mono text-[11px] text-fg-muted">
          {formatarTamanho(anexo.byteSize)}
        </span>
      </span>
      <Download aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
    </a>
  )
}

function Um({ anexo }: { anexo: Anexo }): ReactNode {
  if (ehImagem(anexo)) return <Imagem anexo={anexo} />

  if (ehVideo(anexo)) {
    return (
      <video
        src={urlDoAnexo(anexo.id)}
        controls
        // `metadata` faz o navegador mostrar o primeiro quadro sem baixar o
        // video inteiro. E o motivo de nao existir miniatura de video no
        // servidor: gerar o quadro exigiria ffmpeg na imagem da API para
        // chegar exatamente ao mesmo resultado.
        preload="metadata"
        aria-label={anexo.filename}
        className="max-w-sm rounded border border-border-subtle bg-black"
      />
    )
  }

  if (ehAudio(anexo)) {
    return (
      <figure className="max-w-sm">
        <figcaption className="truncate text-[11px] text-fg-muted">{anexo.filename}</figcaption>
        <audio src={urlDoAnexo(anexo.id)} controls preload="metadata" className="w-full" />
      </figure>
    )
  }

  return <CartaoDeDownload anexo={anexo} />
}

export function Anexos({ anexos }: { anexos: Anexo[] }): ReactNode {
  if (anexos.length === 0) return null

  return (
    <ul className="mt-1 flex flex-col gap-2">
      {anexos.map(anexo => (
        <li key={anexo.id}><Um anexo={anexo} /></li>
      ))}
    </ul>
  )
}
