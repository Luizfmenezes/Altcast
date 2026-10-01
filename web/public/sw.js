/**
 * O service worker do Altcast — o que torna o app instalavel e o abre sem rede.
 *
 * Tres regras, e nenhuma mais esperta do que precisa:
 *
 * 1. NAVEGACAO vai a rede primeiro. O index.html e quem aponta para os
 *    arquivos com hash da versao atual; servi-lo do cache prenderia a pessoa
 *    numa versao velha ate o cache expirar. Sem rede, o index guardado abre o
 *    app — que mostra "reconectando" em vez da pagina de erro do navegador.
 * 2. /assets/ e cache primeiro. O nome traz o hash do conteudo: o mesmo nome e
 *    sempre o mesmo arquivo, entao a rede nao tem nada a acrescentar.
 * 3. API, socket, midia, instalador e modelos de voz NUNCA passam por aqui.
 *    Mensagem servida de cache seria mentira, e os 24 MB do modelo ja tem
 *    cache HTTP proprio.
 */

const VERSAO = 'altcast-v1'
const CASCA = `${VERSAO}-casca`
const ARQUIVOS = `${VERSAO}-arquivos`
const MAXIMO_DE_ARQUIVOS = 120

const CASCA_INICIAL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
]

/** Caminhos que pertencem ao servidor vivo, e nao ao app parado. */
const DE_FORA = ['/api/', '/ws', '/rtc', '/baixar/', '/modelos/']

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CASCA).then(cache => cache.addAll(CASCA_INICIAL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys()
    await Promise.all(nomes.filter(n => !n.startsWith(VERSAO)).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

/** Mantem o cache de arquivos com hash num tamanho razoavel: os mais velhos saem. */
async function aparar() {
  const cache = await caches.open(ARQUIVOS)
  const chaves = await cache.keys()
  for (const velha of chaves.slice(0, Math.max(0, chaves.length - MAXIMO_DE_ARQUIVOS))) {
    await cache.delete(velha)
  }
}

self.addEventListener('fetch', evento => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return
  if (DE_FORA.some(p => url.pathname.startsWith(p))) return

  if (pedido.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const resposta = await fetch(pedido)
        if (resposta.ok) {
          const copia = resposta.clone()
          void caches.open(CASCA).then(c => c.put('/', copia))
        }
        return resposta
      } catch {
        return (await caches.match('/')) ?? Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith((async () => {
      const guardada = await caches.match(pedido)
      if (guardada) return guardada
      const resposta = await fetch(pedido)
      if (resposta.ok) {
        const copia = resposta.clone()
        void caches.open(ARQUIVOS).then(c => c.put(pedido, copia)).then(aparar)
      }
      return resposta
    })())
    return
  }

  // Fontes, icones e o resto do estatico: o que estiver guardado responde na
  // hora, e a rede atualiza por tras para a proxima vez.
  evento.respondWith((async () => {
    const guardada = await caches.match(pedido)
    const daRede = fetch(pedido).then(resposta => {
      if (resposta.ok) {
        const copia = resposta.clone()
        void caches.open(CASCA).then(c => c.put(pedido, copia))
      }
      return resposta
    }).catch(() => guardada ?? Response.error())
    return guardada ?? daRede
  })())
})

/**
 * Clique numa notificacao mostrada por aqui (o caminho do Android, onde
 * `new Notification` nao existe): traz a janela do app para a frente e pede a
 * ela que abra a conversa. Sem janela aberta, abre uma direto no endereco.
 */
self.addEventListener('notificationclick', evento => {
  evento.notification.close()
  const destino = evento.notification.data?.url ?? '/'
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const aberta = janelas[0]
    if (aberta) {
      await aberta.focus()
      aberta.postMessage({ tipo: 'abrir', url: destino })
      return
    }
    await self.clients.openWindow(destino)
  })())
})
