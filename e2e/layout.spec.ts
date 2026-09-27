import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ARQUIVO_GRUPO, ESTADO_DONO } from './global-setup.js'

/**
 * O layout do shell, medido.
 *
 * Nenhum teste anterior cobria isto, e nao por descuido: o jsdom nao tem motor
 * de layout, entao altura, recorte e rolagem sao invisiveis la. Foi por essa
 * fresta que passaram tres defeitos ao mesmo tempo.
 *
 * A causa raiz era uma so. A biblioteca de paineis cria o `Panel` sem declarar
 * `display`, logo ele e um bloco; um filho direto com `flex-1` nao e item flex
 * de ninguem, o `flex-1` morre em silencio e a altura do filho vira `auto`. A
 * secao de conversa crescia ate 1852px dentro de uma coluna de 948px. Dai:
 *
 * - o painel de voz parava de rolar (`scrollHeight === clientHeight`), o
 *   `mt-auto` da barra de acoes resolvia para zero e os botoes da chamada
 *   caiam fora do recorte do painel — invisiveis E fora do hit-testing;
 * - os `.sr-only` do composer, que sao `position:absolute` sem ancestral
 *   posicionado, escapavam do recorte e esticavam o DOCUMENTO para 1928px
 *   contra 1080 de viewport: 848px de fundo preto rolavel.
 *
 * Por isso os tres casos abaixo medem numeros, e nao aparencia.
 */

/** As tres alturas que importam: monitor, laptop e o minimo da janela do app. */
const TAMANHOS = [
  { nome: 'monitor', width: 1920, height: 1080 },
  { nome: 'laptop', width: 1280, height: 800 },
  // O minimo que o Electron aceita (desktop/src/main.ts). E a janela mais
  // apertada que alguem consegue produzir, e era onde o defeito doia mais.
  { nome: 'janela mínima', width: 760, height: 520 },
] as const

/**
 * Abre o canal de voz, venha ele da coluna fixa ou da gaveta.
 *
 * Abaixo de 900px a lista de canais SAI da arvore e so volta pelo botao — e
 * isso e a regra, nao um acidente: um `<nav>` escondido so por CSS continuaria
 * sendo anunciado pelo leitor de tela e tabulavel por quem nao consegue ve-lo.
 * O teste precisa passar pela mesma porta que uma pessoa passaria.
 */
async function abrirCanalDeVoz(page: Page): Promise<void> {
  const lista = page.getByRole('navigation', { name: 'Canais do grupo' })
  const abrir = page.getByRole('button', { name: 'Abrir canais' })
  // Esperar por UM DOS DOIS antes de decidir: logo apos um `reload` nenhum dos
  // dois existe ainda, e um `count()` cru — que nao espera — leria zero e
  // concluiria "e gaveta" mesmo num monitor de 1920px.
  await expect(lista.or(abrir).first()).toBeVisible()
  if (await abrir.isVisible()) await abrir.click()
  await lista.getByRole('button', { name: /sala/ }).first().click()
}

async function sobraDeRolagem(page: Page): Promise<number> {
  return page.evaluate(() =>
    document.documentElement.scrollHeight - window.innerHeight)
}

test.describe('o shell cabe na janela', () => {
  for (const { nome, width, height } of TAMANHOS) {
    test(`o documento não rola em ${nome} (${width}x${height})`, async ({ browser }) => {
      const page = await (await browser.newContext({
        storageState: ESTADO_DONO, viewport: { width, height },
      })).newPage()
      await page.goto('/')
      await expect(page.getByLabel('Escrever mensagem')).toBeVisible()

      // Um pixel de folga cobre arredondamento de subpixel; dois ja seriam
      // conteudo vazando.
      expect(await sobraDeRolagem(page)).toBeLessThanOrEqual(1)
    })
  }

  test('o painel de membros preenche a coluna inteira', async ({ browser }) => {
    const page = await (await browser.newContext({
      storageState: ESTADO_DONO, viewport: { width: 1920, height: 1080 },
    })).newPage()
    await page.goto('/')
    await expect(page.getByLabel('Escrever mensagem')).toBeVisible()

    const medida = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Membros"]')
      const painel = aside?.parentElement
      if (!aside || !painel) return null
      const a = aside.getBoundingClientRect()
      const p = painel.getBoundingClientRect()
      return { altura: a.height / p.height, largura: a.width / p.width }
    })

    expect(medida).not.toBeNull()
    // Antes: 240x438 dentro de um painel de 276x948 — 36px mortos a direita e
    // 510px mortos abaixo, que e a "sobra de espaco" que se via na tela.
    expect(medida!.altura).toBeGreaterThan(0.99)
    expect(medida!.largura).toBeGreaterThan(0.99)
  })
})

test.describe('os controles da chamada sao alcancaveis', () => {
  /** O seed so cria `#geral`; a voz precisa existir para ser medida. */
  async function comCanalDeVoz(page: Page): Promise<void> {
    const grupo = readFileSync(ARQUIVO_GRUPO, 'utf8').trim()
    const criado = await page.request.post(`/api/groups/${grupo}/channels`, {
      data: { name: 'sala', type: 'voice' },
      headers: { origin: new URL(page.url() || 'http://localhost').origin },
    })
    // 409 = ja existe, de uma execucao anterior da suite. Os dois servem.
    expect([200, 201, 409]).toContain(criado.status())
  }

  for (const { nome, width, height } of TAMANHOS) {
    test(`entrar na chamada fica visível em ${nome} (${width}x${height})`, async ({ browser }) => {
      const page = await (await browser.newContext({
        storageState: ESTADO_DONO, viewport: { width, height },
      })).newPage()
      await page.goto('/')
      await expect(page.getByLabel('Escrever mensagem')).toBeVisible()
      await comCanalDeVoz(page)
      await page.reload()

      await abrirCanalDeVoz(page)

      // "Tentar de novo" ocupa o lugar de "Entrar na chamada" quando o SFU nao
      // responde — e o que acontece aqui, sem as portas UDP do LiveKit. O que
      // se mede e o mesmo: a acao primaria do rodape do painel esta ao alcance.
      const entrar = page.getByRole('region', { name: /^Chamada de/ })
        .getByRole('button', { name: /^(Entrar na chamada|Entrando…|Tentar de novo)$/ })
      await expect(entrar).toBeVisible()
      // O teste que o defeito teria reprovado: o botao existia no DOM e era
      // "visivel" para o Playwright, mas estava fora da regiao pintada pelo
      // `overflow:hidden` do painel — ninguem conseguia clicar.
      await expect(entrar).toBeInViewport()

      expect(await sobraDeRolagem(page)).toBeLessThanOrEqual(1)
    })
  }

  test('o painel de voz rola por dentro em vez de estourar', async ({ browser }) => {
    const page = await (await browser.newContext({
      storageState: ESTADO_DONO, viewport: { width: 760, height: 520 },
    })).newPage()
    await page.goto('/')
    await expect(page.getByLabel('Escrever mensagem')).toBeVisible()
    await comCanalDeVoz(page)
    await page.reload()

    await abrirCanalDeVoz(page)
    await expect(page.getByRole('region', { name: /^Chamada de/ })
      .getByRole('button', { name: /^(Entrar na chamada|Entrando…|Tentar de novo)$/ })).toBeVisible()

    const painel = await page.evaluate(() => {
      const s = document.querySelector('section[aria-label^="Chamada"]')
      if (!s) return null
      return { scroll: s.scrollHeight, client: s.clientHeight }
    })

    expect(painel).not.toBeNull()
    // A prova de que a altura e DEFINIDA: um bloco de altura automatica tem
    // sempre `scrollHeight === clientHeight`, e por isso o `overflow-y-auto`
    // dele nunca gerava barra nenhuma.
    expect(painel!.client).toBeLessThanOrEqual(520)
  })
})
