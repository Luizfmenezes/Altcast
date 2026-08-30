import type { Anexo } from './tipos.js'

/**
 * Upload de anexo, com progresso.
 *
 * Usa XMLHttpRequest e nao `fetch`, que e o que o resto do cliente usa. O
 * motivo e unico e suficiente: `fetch` nao reporta progresso de ENVIO. Sem
 * ele, um arquivo de 20 MB numa conexao ruim seria meio minuto de tela parada,
 * indistinguivel de travamento — e a pessoa cancelaria e tentaria de novo,
 * dobrando o problema que a espera ja era.
 */

/** Espelha os limites do servidor. Ver `api/src/media/armazenamento.ts`. */
export const LIMITE_POR_ARQUIVO = 25 * 1024 * 1024
export const MAXIMO_POR_MENSAGEM = 10

export const urlDoAnexo = (id: string): string => `/api/attachments/${id}`
export const urlDaMiniatura = (id: string): string => `/api/attachments/${id}/miniatura`

/**
 * Tamanho legivel. Base 1024 com os nomes curtos, que e o que aparece em
 * gerenciador de arquivos e o que a maioria reconhece de imediato.
 */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const unidades = ['KB', 'MB', 'GB']
  let valor = bytes / 1024
  let i = 0
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i += 1
  }
  // Uma casa decimal so quando ela diz alguma coisa: "1.4 MB" informa,
  // "1398.0 KB" so ocupa espaco.
  return `${valor < 10 ? valor.toFixed(1) : String(Math.round(valor))} ${unidades[i]!}`
}

export type ErroDeUpload = { code: string; message: string }

const MENSAGENS: Record<string, string> = {
  file_too_large: 'O arquivo passa do limite de 25 MB.',
  quota_exceeded: 'O canal atingiu o limite de armazenamento.',
  storage_unavailable: 'Os anexos estao indisponiveis neste servidor.',
  not_found: 'Voce nao pode anexar arquivo neste canal.',
  validation_failed: 'O arquivo esta vazio.',
  network_error: 'Sem conexao com o servidor.',
}

function mensagemDe(code: string, alternativa: string): string {
  return MENSAGENS[code] ?? alternativa
}

function erroDe(bruto: unknown, status: number): ErroDeUpload {
  const envelope = (bruto as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof envelope?.code === 'string' ? envelope.code : 'internal_error'
  return {
    code,
    message: mensagemDe(
      code,
      typeof envelope?.message === 'string'
        ? envelope.message
        : `Nao foi possivel enviar o arquivo (${String(status)}).`,
    ),
  }
}

export type Envio = {
  /** A promessa do anexo pronto. Rejeita com `ErroDeUpload`. */
  pronto: Promise<Anexo>
  /** Interrompe o envio. O que ja subiu o servidor descarta na faxina. */
  cancelar: () => void
}

/**
 * Sobe um arquivo e devolve o anexo criado, ainda sem mensagem.
 *
 * O anexo nasce orfao de proposito: e o que permite mostrar previa e progresso
 * antes de a pessoa decidir o texto — e desistir sem ter mandado nada para a
 * conversa.
 */
export function enviarArquivo(
  channelId: string, arquivo: File, aoProgredir: (fracao: number) => void,
): Envio {
  const xhr = new XMLHttpRequest()

  const pronto = new Promise<Anexo>((resolver, rejeitar) => {
    // Recusar aqui poupa a subida inteira de um arquivo que o servidor vai
    // negar no fim — o pior momento possivel para descobrir.
    if (arquivo.size > LIMITE_POR_ARQUIVO) {
      rejeitar({ code: 'file_too_large', message: mensagemDe('file_too_large', '') })
      return
    }
    if (arquivo.size === 0) {
      rejeitar({ code: 'validation_failed', message: mensagemDe('validation_failed', '') })
      return
    }

    const corpo = new FormData()
    corpo.append('file', arquivo, arquivo.name)

    xhr.upload.addEventListener('progress', evento => {
      if (evento.lengthComputable) aoProgredir(evento.loaded / evento.total)
    })

    xhr.addEventListener('load', () => {
      let resposta: unknown = null
      try {
        resposta = JSON.parse(xhr.responseText)
      } catch {
        // Resposta sem JSON: proxy no caminho, HTML de erro, corpo vazio.
      }
      if (xhr.status === 201) {
        aoProgredir(1)
        resolver(resposta as Anexo)
      } else {
        rejeitar(erroDe(resposta, xhr.status))
      }
    })

    xhr.addEventListener('error', () => {
      rejeitar({ code: 'network_error', message: mensagemDe('network_error', '') })
    })
    xhr.addEventListener('abort', () => {
      rejeitar({ code: 'cancelado', message: 'Envio cancelado.' })
    })

    xhr.open('POST', `/api/channels/${channelId}/attachments`)
    // O cookie de sessao precisa acompanhar: sem isto a rota devolve 401.
    xhr.withCredentials = true
    xhr.send(corpo)
  })

  return { pronto, cancelar: () => { xhr.abort() } }
}

/**
 * Descarta um anexo que ainda nao virou mensagem.
 *
 * Falhar aqui nao vira erro na tela: a faxina do servidor remove o orfao
 * sozinha em 24 horas, e quem clicou em "remover" ja viu o arquivo sair da
 * lista. Um alerta sobre limpeza de bastidor seria ruido sem acao possivel.
 */
export async function descartarAnexo(id: string): Promise<void> {
  try {
    await fetch(urlDoAnexo(id), { method: 'DELETE', credentials: 'include' })
  } catch {
    // Sem rede. A faxina periodica resolve.
  }
}
