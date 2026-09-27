import { test, expect, type Browser, type Page } from '@playwright/test'
import { ESTADO_ANA, ESTADO_DONO } from './global-setup.js'

/**
 * Os fluxos de grupo que estavam quebrados.
 *
 * Cada caso aqui falha contra o codigo anterior a esta fatia, e falha do jeito
 * que a pessoa relatou: a tela nao muda, e so o F5 resolve. A causa era uma
 * so — os canais tinham eventos de tempo real e os grupos nao tinham nenhum —,
 * e por isso os tres primeiros casos sao o mesmo bug visto de tres angulos.
 */

async function abaDe(browser: Browser, estado: string): Promise<Page> {
  const contexto = await browser.newContext({ storageState: estado })
  const page = await contexto.newPage()
  await page.goto('/')
  await expect(page.getByLabel('Escrever mensagem')).toBeVisible()
  return page
}

const barraDeGrupos = (page: Page) => page.getByRole('navigation', { name: /grupos/i })

test.describe('fluxo de grupos', () => {
  test('grupo criado aparece sem recarregar a página', async ({ browser }) => {
    const page = await abaDe(browser, ESTADO_DONO)
    const nome = `Time ${Date.now()}`

    await page.getByRole('button', { name: /Criar grupo/ }).click()
    await page.getByLabel('Nome do grupo').fill(nome)
    await page.getByRole('button', { name: 'Criar grupo', exact: true }).click()

    // A etapa do convite confirma que o POST passou.
    await expect(page.getByText(`${nome} esta pronto`)).toBeVisible()
    await page.getByRole('button', { name: 'Ir para o grupo' }).click()

    // E aqui esta o teste de verdade: SEM reload. Antes, `grupoAtivo` apontava
    // para um grupo que nao estava em `groups[]` e a tela ficava em branco ate
    // alguem apertar F5.
    //
    // Escopado a barra de grupos: o nome aparece em DOIS botoes — o da barra e
    // o cabecalho que abre o menu do grupo —, e sem escopo isto e violacao de
    // modo estrito em vez de asserção.
    await expect(barraDeGrupos(page).getByRole('button', { name: nome, exact: true }))
      .toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Canais do grupo' })
      .getByRole('button', { name: 'geral' })).toBeVisible()

    await page.close()
  })

  test('renomear o grupo muda a barra lateral na hora, e na outra aba também', async ({ browser }) => {
    const page = await abaDe(browser, ESTADO_DONO)
    const espiao = await abaDe(browser, ESTADO_DONO)

    // Um grupo PROPRIO, criado e apagado aqui dentro.
    //
    // A primeira versao deste caso renomeava o grupo do seed — que e o grupo
    // ativo de todo mundo — e isso derrubou quatro casos de `layout.spec.ts`:
    // eles procuram o canal `sala` no grupo do seed, e o `ready` ordena os
    // grupos por nome, entao rebatizar "Anticorp" mudava qual grupo abre
    // sozinho. Teste que reescreve estado compartilhado nao falha nele mesmo;
    // falha no vizinho, e e sempre o vizinho que parece culpado.
    //
    // Apagar ao fim tambem nao e arrumacao opcional: o dono tem teto de tres
    // grupos, e cada caso que cria um sem devolver aproxima a suite do limite
    // ate alguem receber `group_limit_reached` sem ter mudado nada.
    const nomeInicial = `Batismo ${Date.now()}`
    await page.getByRole('button', { name: /Criar grupo/ }).click()
    await page.getByLabel('Nome do grupo').fill(nomeInicial)
    await page.getByRole('button', { name: 'Criar grupo', exact: true }).click()
    await page.getByRole('button', { name: 'Ir para o grupo' }).click()
    await expect(barraDeGrupos(page).getByRole('button', { name: nomeInicial, exact: true }))
      .toBeVisible()

    const id = await barraDeGrupos(page).getByRole('button', { name: nomeInicial, exact: true })
      .getAttribute('data-grupo')

    try {
      const nome = `Renomeado ${Date.now()}`
      await page.getByRole('button', { name: 'Configurações' }).click()
      await page.getByRole('tab', { name: 'Grupo' }).click()
      await page.getByRole('navigation', { name: 'Seções das configurações' })
        .getByRole('button', { name: 'Visão geral' }).click()

      await page.getByLabel('Nome do grupo').fill(nome)
      await page.getByRole('button', { name: 'Salvar nome' }).click()
      await expect(page.getByText('Nome atualizado.')).toBeVisible()
      await page.keyboard.press('Escape')

      // O `PATCH /groups/:id` nao emitia nada, e a store descartava
      // `group.updated` no `default`: renomear um grupo nao mudava a tela de
      // ninguem — nem a de quem renomeou.
      await expect(barraDeGrupos(page).getByRole('button', { name: nome, exact: true }))
        .toBeVisible()
      // E a outra aba tambem, que e o que prova que o evento saiu do servidor
      // em vez de ser um estado local otimista.
      await expect(barraDeGrupos(espiao).getByRole('button', { name: nome, exact: true }))
        .toBeVisible()
    } finally {
      await page.request.delete(`/api/groups/${id}`, {
        headers: { origin: new URL(page.url()).origin },
      })
      await page.close(); await espiao.close()
    }
  })

  test('clicar no canal de voz entra na chamada', async ({ browser }) => {
    const page = await abaDe(browser, ESTADO_DONO)

    // Um canal de voz proprio, para nao disputar a sala com outro caso.
    const nomeDoCanal = `voz-${Date.now().toString().slice(-6)}`
    await page.getByRole('button', { name: 'Configurações' }).click()
    await page.getByRole('tab', { name: 'Grupo' }).click()
    await page.getByRole('navigation', { name: 'Seções das configurações' })
      .getByRole('button', { name: 'Canais' }).click()
    await page.getByLabel('Nome do canal').fill(nomeDoCanal)
    await page.getByLabel('Tipo').selectOption('voice')
    await page.getByRole('button', { name: 'Criar canal' }).click()
    await page.keyboard.press('Escape')

    const canal = page.getByRole('navigation', { name: 'Canais do grupo' })
      .getByRole('button', { name: nomeDoCanal })
    await expect(canal).toBeVisible()
    await canal.click()

    // Um clique, e nao dois. Antes, clicar so selecionava o canal e entrar
    // exigia achar "Entrar na chamada" noutro canto da tela.
    await expect(page.getByRole('button', { name: /Sair da chamada/i })).toBeVisible({
      timeout: 20_000,
    })

    await page.close()
  })

  test('entrar por link de convite já estando logado', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)
    const nome = `Convidável ${Date.now()}`

    await dono.getByRole('button', { name: /Criar grupo/ }).click()
    await dono.getByLabel('Nome do grupo').fill(nome)
    await dono.getByRole('button', { name: 'Criar grupo', exact: true }).click()
    const link = await dono.getByLabel('Link de convite').inputValue()
    const codigo = link.split('/').pop()!
    await dono.getByRole('button', { name: 'Ir para o grupo' }).click()

    // Ana ja tem sessao. Ate esta fatia, abrir /convite/CODIGO logado caia no
    // aplicativo normal e o codigo era descartado em SILENCIO: so `TelaAuth`
    // — a tela de quem esta de fora — lia a rota, e `AppShell` nunca olhava
    // para ela. A impressao era de link quebrado.
    const ana = await abaDe(browser, ESTADO_ANA)
    await ana.goto(`/convite/${codigo}`)

    await expect(ana.getByRole('dialog').getByText(`Entrar em ${nome}?`)).toBeVisible()
    await ana.getByRole('button', { name: 'Entrar', exact: true }).click()

    await expect(barraDeGrupos(ana).getByRole('button', { name: new RegExp(nome) }))
      .toBeVisible()

    await dono.close(); await ana.close()
  })

  test('cargo criado pinta o nome na lista de membros', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)

    await dono.getByRole('button', { name: 'Configurações' }).click()
    await dono.getByRole('tab', { name: 'Grupo' }).click()
    await dono.getByRole('navigation', { name: 'Seções das configurações' })
      .getByRole('button', { name: 'Cargos' }).click()

    const nomeDoCargo = `Mod${Date.now().toString().slice(-5)}`
    await dono.getByRole('button', { name: 'Novo cargo' }).click()
    await dono.getByLabel('Nome do cargo').first().fill(nomeDoCargo)
    await dono.getByRole('button', { name: 'Criar', exact: true }).click()

    // O cargo aparece na lista da esquerda — veio pelo `role.created` do
    // socket, e nao de um refetch.
    await expect(dono.getByRole('button', { name: nomeDoCargo })).toBeVisible()

    // A parede de interruptores existe e e legivel: rotulo por extenso, e nao
    // o literal da acao.
    await expect(dono.getByText('Remover membros')).toBeVisible()
    await expect(dono.getByText('poder sobre pessoas').first()).toBeVisible()

    await dono.close()
  })
})
