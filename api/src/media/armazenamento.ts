import { Client } from 'minio'
import type { Readable } from 'node:stream'
import { env } from '../env.js'

/**
 * Onde os bytes dos anexos ficam.
 *
 * Este e o unico arquivo da API que conhece o MinIO. Acima dele so existe
 * "guardar", "ler" e "remover" — nunca bucket, objeto ou assinatura. Trocar
 * por S3 de verdade e trocar o endereco no .env; trocar por disco local seria
 * reescrever este arquivo e mais nenhum.
 *
 * O navegador NUNCA fala com o storage. Todo byte entra e sai pela API, que e
 * o unico lugar onde `can()` existe. Um anexo de canal privado servido por URL
 * do proprio MinIO seria legivel por quem tivesse o link, membro ou nao — e a
 * spec 03 gasta uma secao inteira impedindo exatamente isso para o texto.
 */

/** Limites de tamanho. Ver spec do chat rico, secao 5. */
export const LIMITE_POR_ARQUIVO = 25 * 1024 * 1024
export const MAXIMO_POR_MENSAGEM = 10
export const COTA_POR_CANAL = 5 * 1024 * 1024 * 1024

export type ConfiguracaoDeArmazenamento = {
  endPoint: string
  port: number
  useSSL: boolean
  accessKey: string
  secretKey: string
  bucket: string
}

/**
 * As quatro variaveis, ou nada. Meia configuracao nao e meio armazenamento: e
 * um 503 honesto, e por isso devolve null em vez de tentar conectar com o que
 * tem e falhar no meio de um upload.
 */
export function configuracaoDeArmazenamento(bruto: {
  endPoint?: string | undefined
  port?: number | undefined
  accessKey?: string | undefined
  secretKey?: string | undefined
  bucket?: string | undefined
  useSSL?: boolean | undefined
}): ConfiguracaoDeArmazenamento | null {
  const { endPoint, accessKey, secretKey } = bruto
  if (!endPoint || !accessKey || !secretKey) return null
  return {
    endPoint,
    port: bruto.port ?? 9000,
    useSSL: bruto.useSSL ?? false,
    accessKey,
    secretKey,
    bucket: bruto.bucket ?? 'altcast',
  }
}

/**
 * A superficie do armazenamento que de fato usamos.
 *
 * Existe para que os testes de rota possam injetar um armazem em memoria sem
 * subir um MinIO — e, de quebra, documenta em cinco linhas o tamanho real do
 * acoplamento com a biblioteca.
 */
export type Armazem = {
  guardar: (chave: string, dados: Buffer, contentType: string) => Promise<void>
  ler: (chave: string) => Promise<Readable>
  remover: (chaves: string[]) => Promise<void>
}

let cliente: Client | null = null
let bucketPronto = false

function conectar(cfg: ConfiguracaoDeArmazenamento): Client {
  cliente ??= new Client({
    endPoint: cfg.endPoint,
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  })
  return cliente
}

/**
 * Cria o bucket na primeira escrita, e nao no arranque.
 *
 * No arranque, o MinIO pode ainda nao estar de pe — e derrubar a API inteira
 * porque o armazenamento demorou dez segundos a mais que o Postgres seria
 * trocar uma indisponibilidade parcial por uma total.
 */
async function garantirBucket(c: Client, bucket: string): Promise<void> {
  if (bucketPronto) return
  if (!await c.bucketExists(bucket)) await c.makeBucket(bucket)
  bucketPronto = true
}

export function armazemDe(cfg: ConfiguracaoDeArmazenamento): Armazem {
  const c = conectar(cfg)
  return {
    guardar: async (chave, dados, contentType) => {
      await garantirBucket(c, cfg.bucket)
      await c.putObject(cfg.bucket, chave, dados, dados.length, {
        'Content-Type': contentType,
      })
    },
    ler: async chave => c.getObject(cfg.bucket, chave),
    remover: async chaves => {
      if (chaves.length === 0) return
      await c.removeObjects(cfg.bucket, chaves)
    },
  }
}

/** O armazem configurado, ou null quando o operador nao configurou nenhum. */
export function armazemPadrao(): Armazem | null {
  const cfg = configuracaoDeArmazenamento({
    endPoint: env.STORAGE_ENDPOINT,
    port: env.STORAGE_PORT,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
    bucket: env.STORAGE_BUCKET,
    useSSL: env.STORAGE_USE_SSL,
  })
  return cfg === null ? null : armazemDe(cfg)
}

/**
 * O caminho do objeto. Derivado do id, jamais do nome enviado.
 *
 * Um `filename` que chegasse ate aqui traria `../` junto e escolheria onde
 * gravar. O nome original vive so na coluna `filename`, como rotulo.
 */
export const chaveDe = (id: string): string => `anexos/${id.slice(0, 2)}/${id}`
export const chaveDaMiniatura = (id: string): string => `miniaturas/${id.slice(0, 2)}/${id}`
