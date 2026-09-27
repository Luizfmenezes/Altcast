import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ANA, ARQUIVO_GRUPO, DONO, ESTADO_ANA, ESTADO_DONO } from './global-setup.js'

/**
 * O canal na barra lateral.
 *
 * Era `getByRole('tab', { name: '# nome' })`. A lista deixou de ser um
 * `tablist`: um tablist exige que os filhos sejam `tab`, e as secoes
 * colapsaveis colocam entre eles um cabecalho focavel que nao e. Hoje e
 * navegacao, o `#` virou icone, e o nome acessivel e so o nome do canal.
 */
function canalNaBarra(pagina: Page, nome: string) {
  return pagina
    .getByRole('navigation', { name: 'Canais do grupo' })
    // Sem `exact`: canal privado acrescenta um sr-only "(canal privado)" ao
    // nome acessivel, porque o cadeado sozinho nao existe para quem nao ve.
    .getByRole('button', { name: nome })
}


const GRUPO = (): string => readFileSync(ARQUIVO_GRUPO, 'utf8').trim()

/** O compose exige as variaveis mesmo para um `restart`. */
const AMBIENTE_COMPOSE = {
  ...process.env,
  POSTGRES_PASSWORD: 'e2e_local',
  ALLOWED_ORIGINS: 'http://localhost',
  PUBLIC_URL: 'http://localhost',
  PUBLIC_DOMAIN: 'http://localhost',
}

/**
 * Abre uma aba ja autenticada.
 *
 * A sessao vem do disco, gravada uma unica vez no globalSetup: repetir o login
 * a cada teste faria a suite bater no limite de cinco por minuto por IP e
 * quebrar por causa de um comportamento que esta correto.
 */
async function abaDe(browser: Browser, estado: string): Promise<Page> {
  const contexto = await browser.newContext({ storageState: estado })
  const page = await contexto.newPage()
  await page.goto('/')
  await expect(page.getByLabel('Escrever mensagem')).toBeVisible()
  return page
}

/** Aba anonima, para os caminhos que comecam na porta de entrada. */
async function abaAnonima(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext()
  return contexto.newPage()
}

test.describe('fluxos da Fatia 1', () => {
  test('convite completo entre dois navegadores', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)

    await dono.getByRole('button', { name: 'Configurações' }).click()
    await dono.getByRole('tab', { name: 'Grupo' }).click()
    // A tela de grupo deixou de ser um scroll unico com tudo empilhado e virou
    // um menu de secoes: com cargos e identidade entrando, viraram cinco
    // assuntos, e cargos sozinho precisa de duas colunas. O convite agora tem
    // nome proprio no menu — que e justamente o que o scroll nao dava.
    await dono.getByRole('navigation', { name: 'Seções das configurações' })
      .getByRole('button', { name: 'Convites' }).click()
    await dono.getByRole('button', { name: 'Gerar link' }).click()

    const codigo = (await dono.getByRole('dialog').locator('code').first().textContent())?.trim()
    expect(codigo).toMatch(/^[0-9A-Z]{8}$/)
    await dono.keyboard.press('Escape')

    const convidado = await abaAnonima(browser)
    await convidado.goto(`/convite/${codigo}`)

    // A previa mostra o grupo antes de qualquer credencial - e apenas o grupo.
    await expect(convidado.getByText('Anticorp')).toBeVisible()

    await convidado.getByRole('button', { name: 'Criar conta' }).click()
    await convidado.getByLabel('Nome de exibição').fill('Carlos')
    await convidado.getByLabel('E-mail').fill('carlos@altcast.test')
    await convidado.getByLabel('Senha').fill('terceira-frase-longa-de-teste')
    await convidado.getByRole('button', { name: 'Criar conta e entrar' }).click()

    await expect(convidado.getByLabel('Escrever mensagem')).toBeVisible()

    // O dono ve o membro novo aparecer SEM recarregar: e o member.joined
    // chegando pelo socket.
    await expect(dono.getByLabel(/^Carlos, /)).toBeVisible({ timeout: 15_000 })
  })

  test('mensagem em tempo real', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)
    const ana = await abaDe(browser, ESTADO_ANA)

    const texto = `olá do dono ${Date.now()}`
    await dono.getByLabel('Escrever mensagem').fill(texto)
    await dono.keyboard.press('Enter')

    // Sem recarregar nada do outro lado.
    await expect(ana.getByText(texto)).toBeVisible({ timeout: 15_000 })
    // E o proprio autor tambem ve, com o eco ja reconciliado pelo mesmo ID.
    await expect(dono.getByText(texto)).toBeVisible()
  })

  test('canal privado aparece e some ao vivo', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)
    const ana = await abaDe(browser, ESTADO_ANA)

    const nome = `sigilo${Date.now().toString().slice(-6)}`
    const criado = await dono.request.post(`/api/groups/${GRUPO()}/channels`, {
      data: { name: nome, visibility: 'private' },
      headers: { origin: 'http://localhost' },
    })
    expect(criado.status()).toBe(201)
    const canal = (await criado.json()).id as string

    // Ana nao participa: para ela o canal nao existe - nem o nome, nem o ID.
    await expect(canalNaBarra(ana, nome)).toHaveCount(0)
    expect(await ana.content()).not.toContain(nome)
    expect(await ana.content()).not.toContain(canal)

    const idDaAna = await ana.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' })
      return ((await r.json()) as { user: { id: string } }).user.id
    })

    await dono.request.post(`/api/channels/${canal}/members`, {
      data: { userId: idDaAna },
      headers: { origin: 'http://localhost' },
    })

    // Aparece na hora: channel.created vai so para quem foi adicionado.
    await expect(canalNaBarra(ana, nome)).toBeVisible({ timeout: 15_000 })

    await dono.request.delete(`/api/channels/${canal}/members/${idDaAna}`, {
      headers: { origin: 'http://localhost' },
    })

    // E some na hora: channel.deleted vai so para quem saiu.
    await expect(canalNaBarra(ana, nome)).toHaveCount(0, { timeout: 15_000 })
  })

  test('reconexão cura o buraco', async ({ browser }) => {
    const offline = await abaDe(browser, ESTADO_DONO)
    const online = await abaDe(browser, ESTADO_ANA)

    // A ordem importa. `setOffline` nao derruba um socket ja aberto, mas
    // impede que um novo suba; reiniciar a API derruba os dois lados. Offline
    // primeiro, restart depois: a aba perde a conexao e fica impedida de
    // voltar, enquanto a outra reconecta sozinha e continua conversando.
    await offline.context().setOffline(true)
    execSync('docker compose restart api', { stdio: 'ignore', env: AMBIENTE_COMPOSE })

    await expect(offline.getByRole('status', { name: 'Estado da conexão' }))
      .toContainText(/Reconectando|Sem conexão/, { timeout: 60_000 })

    // A outra aba reconecta sozinha e volta a falar. Conectada, a calha se
    // cala: a regiao viva fica vazia, pronta para anunciar a proxima queda.
    await expect(online.getByRole('status', { name: 'Estado da conexão' }))
      .toHaveText('', { timeout: 60_000 })

    const marca = Date.now()
    for (const n of [1, 2, 3]) {
      await online.getByLabel('Escrever mensagem').fill(`perdida ${n} ${marca}`)
      await online.keyboard.press('Enter')
      await expect(online.getByText(`perdida ${n} ${marca}`)).toBeVisible({ timeout: 20_000 })
    }

    // Nada disso chegou a aba no escuro: o socket dela esta cortado.
    expect(await offline.content()).not.toContain(`perdida 1 ${marca}`)

    await offline.context().setOffline(false)

    // As tres aparecem sem recarregar a pagina: o socket voltou e o cliente
    // perguntou ao REST o que perdeu. E a prova, no sistema montado, da
    // decisao arquitetural central do projeto - nao existe replay no servidor.
    for (const n of [1, 2, 3]) {
      await expect(offline.getByText(`perdida ${n} ${marca}`)).toBeVisible({ timeout: 60_000 })
    }
  })

  test('sessão revogada bloqueia o outro dispositivo imediatamente', async ({
    browser, playwright,
  }) => {
    // O aparelho a ser encerrado e criado por este teste, com um user-agent
    // proprio. Encerrar "a primeira sessao que nao e a minha" derrubaria a
    // sessao compartilhada do globalSetup e quebraria os testes seguintes por
    // um motivo que nada tem a ver com o que esta sendo verificado.
    const aparelho = `AparelhoDeTeste-${Date.now().toString().slice(-6)}`
    const antigo = await playwright.request.newContext({
      baseURL: 'http://localhost',
      extraHTTPHeaders: { origin: 'http://localhost', 'user-agent': aparelho },
    })
    const entrada = await antigo.post('/api/auth/login', {
      data: { email: DONO.email, password: DONO.senha },
    })
    expect(entrada.ok()).toBe(true)

    const novo = await abaDe(browser, ESTADO_DONO)
    await novo.getByRole('button', { name: 'Configurações' }).click()

    // As sessoes moraram na primeira tela do dialogo enquanto ela era unica.
    // Agora o dialogo abre em "Perfil", e a lista de aparelhos vive em
    // "Conta" - o teste atravessa a aba como qualquer pessoa atravessaria.
    await novo.getByRole('tab', { name: 'Conta' }).click()

    const encerrar = novo.getByRole('button', { name: `Encerrar ${aparelho}` })
    await expect(encerrar).toBeVisible()
    await encerrar.click()
    await novo.getByRole('button', { name: 'Encerrar sessão' }).click()

    // O efeito e imediato porque a sessao mora no banco: revogar apaga a
    // linha. Com JWT assinado, o acesso sobreviveria ate o vencimento.
    await expect.poll(
      async () => (await antigo.get('/api/auth/me')).status(),
      { timeout: 20_000 },
    ).toBe(401)

    // E a sessao de quem revogou continua valendo.
    await expect(novo.getByLabel('Escrever mensagem')).toBeVisible()
    await antigo.dispose()
  })

  test('percurso completo só com teclado', async ({ browser, playwright }) => {
    // Navegar entre canais exige mais de um canal. O segundo e publico, entao
    // aparece para Ana na hora - o que de quebra prova o channel.created
    // chegando a quem nao pediu nada.
    const comoDono = await playwright.request.newContext({
      baseURL: 'http://localhost',
      storageState: ESTADO_DONO,
      extraHTTPHeaders: { origin: 'http://localhost' },
    })
    const segundoCanal = `pauta${Date.now().toString().slice(-6)}`
    const criado = await comoDono.post(`/api/groups/${GRUPO()}/channels`, {
      data: { name: segundoCanal },
    })
    expect(criado.status()).toBe(201)
    await comoDono.dispose()

    const page = await abaDe(browser, ESTADO_ANA)
    await expect(canalNaBarra(page, segundoCanal))
      .toBeVisible({ timeout: 15_000 })

    // O primeiro foco da aplicacao e o atalho para a conversa.
    await page.locator('body').press('Tab')
    await expect.poll(
      () => page.evaluate(() => document.activeElement?.textContent ?? ''),
    ).toContain('Pular para a conversa')

    // Trocar de canal por atalho leva o foco ao campo de escrita.
    await page.keyboard.press('Alt+ArrowDown')
    await expect(page.getByLabel('Escrever mensagem')).toBeFocused()

    const texto = `só teclado ${Date.now()}`
    await page.keyboard.type(texto)
    await page.keyboard.press('Enter')
    await expect(page.getByText(texto)).toBeVisible()

    // Abrir e fechar a sobreposicao, devolvendo o foco ao gatilho.
    const gatilho = page.getByRole('button', { name: 'Configurações' })
    await gatilho.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(gatilho).toBeFocused()
  })
})

test.describe('a conta de Ana existe e entra pela porta da frente', () => {
  test('a sessão guardada corresponde a conta certa', async ({ browser }) => {
    const ana = await abaDe(browser, ESTADO_ANA)
    const email = await ana.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' })
      return ((await r.json()) as { user: { displayName: string } }).user.displayName
    })
    expect(email).toBe('Ana')
    expect(ANA.email).toContain('@')
  })
})

/**
 * Os fluxos da Etapa 0 do super plano: nenhuma pessoa perde um convite nem a
 * propria sessao.
 */
test.describe('confianca (Etapa 0)', () => {
  /** Conta nova, sem grupo, deslogada ao fim — para nao mexer nas sessoes gravadas. */
  async function contaNova(pagina: Page, prefixo: string): Promise<{ email: string; senha: string }> {
    const email = `${prefixo}${Date.now()}@altcast.test`
    const senha = 'uma-frase-longa-de-teste-e2e'
    const r = await pagina.request.post('/api/auth/register', {
      data: { email, password: senha, displayName: prefixo },
      headers: { origin: 'http://localhost' },
    })
    expect(r.status()).toBe(201)
    return { email, senha }
  }

  test('convite → "já tenho conta" → entra direto no grupo', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)
    const gerado = await dono.request.post(`/api/groups/${GRUPO()}/invites`, {
      data: {}, headers: { origin: 'http://localhost' },
    })
    const { code } = await gerado.json() as { code: string }

    const pessoa = await abaAnonima(browser)
    const { email, senha } = await contaNova(pessoa, 'rita')
    await pessoa.request.post('/api/auth/logout', { headers: { origin: 'http://localhost' } })

    await pessoa.goto(`/convite/${code}`)
    await pessoa.getByRole('button', { name: 'Já tenho conta' }).click()

    // O login sabe do convite: o cartao do grupo continua na tela.
    await expect(pessoa).toHaveURL(new RegExp(`/entrar[?]convite=${code}$`))
    await expect(pessoa.getByRole('region', { name: 'Convite' })).toContainText('Anticorp')

    await pessoa.getByLabel('E-mail').fill(email)
    await pessoa.getByLabel('Senha').fill(senha)
    await pessoa.getByRole('button', { name: 'Entrar', exact: true }).click()

    // Aceito sozinho, sem perguntar de novo, e o grupo aberto.
    await expect(pessoa.getByRole('navigation', { name: 'Grupos' })
      .getByRole('button', { name: /Anticorp/ })).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    await expect(pessoa).toHaveURL(/\/$/)
  })

  test('sair da conta encerra a sessão e volta à porta de entrada', async ({ browser }) => {
    const pessoa = await abaAnonima(browser)
    await contaNova(pessoa, 'saulo')
    await pessoa.goto('/')

    // Conta nova ainda nao tem grupo: e a tela de boas-vindas, que tambem
    // precisa deixar sair. (Com grupo, o "Sair" mora no menu do avatar.)
    await pessoa.getByRole('button', { name: 'Sair' }).click()

    await expect(pessoa.getByLabel('Senha')).toBeVisible()
    const me = await pessoa.request.get('/api/auth/me')
    expect(me.status()).toBe(401)
  })

  test('no celular, os dois botões do convite cabem no diálogo', async ({ browser }) => {
    const dono = await abaDe(browser, ESTADO_DONO)
    const gerado = await dono.request.post(`/api/groups/${GRUPO()}/invites`, {
      data: {}, headers: { origin: 'http://localhost' },
    })
    const { code } = await gerado.json() as { code: string }

    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const pessoa = await contexto.newPage()
    await contaNova(pessoa, 'celia')
    await pessoa.goto(`/convite/${code}`)

    const dialogo = pessoa.getByRole('dialog')
    const entrar = dialogo.getByRole('button', { name: 'Entrar', exact: true })
    await expect(entrar).toBeVisible()
    const caixa = await dialogo.boundingBox()
    const botao = await entrar.boundingBox()
    expect(botao!.x + botao!.width).toBeLessThanOrEqual(caixa!.x + caixa!.width)
    expect(botao!.x + botao!.width).toBeLessThanOrEqual(390)
  })
})
