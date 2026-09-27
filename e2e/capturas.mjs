// Capturas de revisao visual (nao e teste): desktop 1440 e mobile 390, temas
// claro e escuro. Usa as sessoes gravadas pelo global-setup do e2e.
//   node e2e/capturas.mjs <pasta-de-saida>
/* global process, console, localStorage */
import { chromium, request } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = 'http://localhost'
const SAIDA = process.argv[2] ?? 'test-results/capturas'
mkdirSync(SAIDA, { recursive: true })
// Sem sessao valida (o teardown do e2e apaga o volume), sobe e semeia de novo
// pelo proprio global-setup.
const vivo = await (async () => {
  try {
    const r = await (await request.newContext({ baseURL: BASE, storageState: 'e2e/.auth/dono.json' })).get('/api/auth/me')
    return r.ok()
  } catch { return false }
})()
if (!vivo) {
  const { default: preparar } = await import('./global-setup.ts')
  await preparar()
}
const grupo = readFileSync('e2e/.auth/grupo.txt', 'utf8').trim()

const dono = await request.newContext({ baseURL: BASE, storageState: 'e2e/.auth/dono.json', extraHTTPHeaders: { origin: BASE } })
const ana = await request.newContext({ baseURL: BASE, storageState: 'e2e/.auth/ana.json', extraHTTPHeaders: { origin: BASE } })

// Cenario: um canal de voz, um cargo colorido para a Ana, algumas mensagens.
const me = await (await ana.get('/api/auth/me')).json()
const canais = await (await dono.get(`/api/groups/${grupo}/channels`)).json()
const geral = (Array.isArray(canais) ? canais : canais.channels ?? []).find(c => c.name === 'geral')
await dono.post(`/api/groups/${grupo}/channels`, { data: { name: 'sala', type: 'voice' } })
const cargo = await dono.post(`/api/groups/${grupo}/roles`, { data: { name: 'Moderação', color: '#4dacf6' } })
if (cargo.ok()) {
  const { id } = await cargo.json()
  await dono.put(`/api/groups/${grupo}/members/${me.user.id}/roles`, { data: { roleIds: [id] } })
}
if (geral) {
  const falas = [
    [ana, 'Bom dia! Alguém viu a pauta de hoje?'],
    [ana, 'Queria revisar antes da reunião das 15h.'],
    [dono, 'Vi sim, @Ana — mandei no fio de ontem. Resumo: orçamento, cronograma e a transmissão de sexta.'],
    [ana, 'Perfeito, obrigada. Vou abrir a sala de voz uns minutos antes para testar o áudio.'],
  ]
  for (const [quem, texto] of falas) {
    await quem.post(`/api/channels/${geral.id}/messages`, { data: { content: texto } })
  }
}

const navegador = await chromium.launch()
async function capturar(nome, { tema, largura, altura, sessao, caminho = '/', acao }) {
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura },
    ...(sessao ? { storageState: sessao } : {}),
  })
  await contexto.addInitScript(t => { try { localStorage.setItem('altcast:tema', t) } catch { /* sem armazenamento: fica no padrao */ } }, tema)
  const pagina = await contexto.newPage()
  await pagina.goto(`${BASE}${caminho}`)
  await pagina.waitForTimeout(1200)
  if (acao) await acao(pagina)
  await pagina.screenshot({ path: `${SAIDA}/${nome}-${tema}-${largura}.png` })
  await contexto.close()
}

for (const tema of ['dark', 'light']) {
  await capturar('login', { tema, largura: 1440, altura: 900 })
  await capturar('login', { tema, largura: 390, altura: 844 })
  await capturar('conversa', { tema, largura: 1440, altura: 900, sessao: 'e2e/.auth/dono.json' })
  await capturar('conversa', { tema, largura: 390, altura: 844, sessao: 'e2e/.auth/dono.json' })
  await capturar('hover', {
    tema, largura: 1440, altura: 900, sessao: 'e2e/.auth/dono.json',
    acao: async p => { await p.getByText('Perfeito, obrigada').last().hover(); await p.waitForTimeout(300) },
  })
  await capturar('voz', {
    tema, largura: 1440, altura: 900, sessao: 'e2e/.auth/dono.json',
    acao: async p => {
      await p.getByRole('navigation', { name: 'Canais do grupo' }).getByRole('button', { name: /sala/ }).first().click()
      await p.waitForTimeout(2500)
    },
  })
}
await navegador.close()
console.log('ok', SAIDA)
