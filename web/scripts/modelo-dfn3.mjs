// Baixa o DeepFilterNet3 (a "IA alta qualidade") para web/public/modelos/dfn3.
//
// Fica fora do repositorio porque sao 24 MB, que ficariam para sempre no
// historico do git a cada versao. Cada arquivo tem o SHA-256 fixado aqui: um
// CDN que passe a servir outra coisa nao entra no build.
//
// Falhar NAO derruba o build. Sem os arquivos, o servidor responde 404, a
// chamada percebe (`ModeloIndisponivel`) e cai para a IA padrao, que vem
// empacotada — a pessoa perde a alta qualidade, e nao a supressao. O aviso
// fica no log do build.
//
// ALTCAST_SEM_DFN3=1 pula o download (CI, maquina sem rede).

/* global process, console, Buffer, fetch, AbortSignal */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3'
const DESTINO = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'modelos', 'dfn3')

const ARQUIVOS = [
  {
    nome: 'df_bg.wasm',
    url: `${BASE}/pkg/df_bg.wasm`,
    sha256: '440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432',
  },
  {
    nome: 'DeepFilterNet3_onnx.tar.gz',
    url: `${BASE}/models/DeepFilterNet3_onnx.tar.gz`,
    sha256: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616',
  },
]

const hashDe = bytes => createHash('sha256').update(bytes).digest('hex')

async function garantir({ nome, url, sha256 }) {
  const caminho = join(DESTINO, nome)
  if (existsSync(caminho) && hashDe(readFileSync(caminho)) === sha256) return 'ja estava'
  const resposta = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!resposta.ok) throw new Error(`${url}: HTTP ${resposta.status}`)
  const bytes = Buffer.from(await resposta.arrayBuffer())
  const obtido = hashDe(bytes)
  if (obtido !== sha256) throw new Error(`${nome}: SHA-256 ${obtido}, esperado ${sha256}`)
  writeFileSync(caminho, bytes)
  return `baixado (${(bytes.length / 1e6).toFixed(1)} MB)`
}

if (process.env.ALTCAST_SEM_DFN3 === '1') {
  console.log('[dfn3] pulado (ALTCAST_SEM_DFN3=1); a alta qualidade cai para a IA padrao')
} else {
  mkdirSync(DESTINO, { recursive: true })
  for (const arquivo of ARQUIVOS) {
    try {
      console.log(`[dfn3] ${arquivo.nome}: ${await garantir(arquivo)}`)
    } catch (erro) {
      // Um arquivo pela metade e pior que nenhum: o navegador o baixaria, e o
      // WebAssembly.compile falharia la, longe daqui.
      rmSync(join(DESTINO, arquivo.nome), { force: true })
      console.warn(`[dfn3] AVISO: ${arquivo.nome} indisponivel (${erro.message}).`
        + ' A "IA alta qualidade" vai cair para a IA padrao neste build.')
    }
  }
}
