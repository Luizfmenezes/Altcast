import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ESTADO_DONO } from './global-setup.js'

/**
 * Varredura automatizada nao substitui julgamento: ela pega algo como metade
 * dos problemas reais. Serve para que a metade mecanica - rotulo ausente,
 * contraste, papel invalido, ordem de cabecalho - nunca chegue a producao por
 * distracao, e roda contra o stack montado, com o CSS de verdade aplicado.
 */
async function varrer(page: Page): Promise<unknown[]> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return resultado.violations
}

test.describe('acessibilidade WCAG 2.2 AA', () => {
  test('tela de login', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('E-mail')).toBeVisible()
    expect(await varrer(page)).toEqual([])
  })

  test('previa de convite e cadastro', async ({ page, browser }) => {
    // Sessao vinda do disco: o login tem limite por IP, e gasta-lo aqui faria
    // outro teste falhar por um motivo que nada tem a ver com acessibilidade.
    const dono = await (await browser.newContext({ storageState: ESTADO_DONO })).newPage()
    await dono.goto('/')
    await expect(dono.getByLabel('Escrever mensagem')).toBeVisible()

    await dono.getByRole('button', { name: 'Configuracoes' }).click()
    await dono.getByRole('tab', { name: 'Grupo' }).click()
    await dono.getByRole('button', { name: 'Gerar convite' }).click()
    const codigo = (await dono.getByRole('dialog').locator('code').first().textContent())?.trim()

    await page.goto(`/convite/${codigo}`)
    await expect(page.getByText('Anticorp')).toBeVisible()
    expect(await varrer(page)).toEqual([])

    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page.getByLabel('Nome de exibicao')).toBeVisible()
    expect(await varrer(page)).toEqual([])
  })

  test('aplicacao e configuracoes', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: ESTADO_DONO })).newPage()
    await page.goto('/')
    await expect(page.getByLabel('Escrever mensagem')).toBeVisible()

    expect(await varrer(page)).toEqual([])

    await page.getByRole('button', { name: 'Configuracoes' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await varrer(page)).toEqual([])
  })

  test('sem rolagem horizontal em zoom de 400%', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: ESTADO_DONO })).newPage()
    await page.goto('/')
    await expect(page.getByLabel('Escrever mensagem')).toBeVisible()

    // 1280 / 4 = 320px de largura efetiva: e o que a SC 1.4.10 Reflow exige
    // que continue utilizavel sem rolar para o lado.
    await page.setViewportSize({ width: 320, height: 512 })

    const rolaParaOLado = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(rolaParaOLado).toBe(false)
  })
})
