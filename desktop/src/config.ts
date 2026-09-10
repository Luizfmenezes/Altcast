/**
 * De onde a janela carrega a interface.
 *
 * O app NAO empacota o SPA: ele abre a URL do servidor. A razao e a
 * autenticacao, e ela e decisiva. O cookie de sessao e `SameSite=Lax`
 * (api/src/routes/auth.routes.ts) e toda escrita valida o `Origin` contra
 * ALLOWED_ORIGINS (api/src/index.ts). Uma janela apontada para o dominio real
 * e first-party e passa nas duas regras sem uma linha de API alterada;
 * empacotar o SPA faria a origem virar `app://`, transformaria o cookie em
 * third-party e exigiria trocar o modelo de autenticacao inteiro.
 *
 * O efeito colateral e bem-vindo: um deploy do `web/` atualiza a interface de
 * todo mundo sem ninguem reinstalar nada. A casca so muda quando muda o que
 * esta neste diretorio.
 */

/**
 * O dominio de producao. **Trocar aqui antes de gerar o instalador.**
 *
 * E uma constante compilada, e nao uma variavel de ambiente, porque variavel
 * de ambiente nao existe na maquina de quem instala: `ALTCAST_URL` abaixo
 * serve ao desenvolvimento, e um `.exe` distribuido nunca a teria definida.
 */
const URL_DE_PRODUCAO = 'https://altcast.altcorphub.com'

/** O Vite em `npm run dev -w @altcast/web`. */
const URL_DE_DESENVOLVIMENTO = 'http://localhost:5173'

/**
 * A URL que a janela abre.
 *
 * `ALTCAST_URL` vence tudo: e o que permite apontar o app para uma VPS de
 * teste sem recompilar. Sem ela, empacotado usa producao e nao-empacotado usa
 * o Vite — o padrao certo para cada caso, sem ninguem precisar lembrar.
 */
export function urlDoAltcast(empacotado: boolean): string {
  const escolhida = process.env['ALTCAST_URL']?.trim()
  if (escolhida !== undefined && escolhida !== '') return escolhida
  return empacotado ? URL_DE_PRODUCAO : URL_DE_DESENVOLVIMENTO
}

/**
 * A origem — esquema, host e porta — da URL acima.
 *
 * E o que separa "navegar" de "sair do app". Toda navegacao para fora desta
 * origem vai para o navegador do sistema, e nao para dentro desta janela: uma
 * janela com `nodeIntegration` desligado ainda assim nao deve carregar HTML de
 * terceiro, e um link de convite postado no chat nao pode virar caminho para
 * uma pagina qualquer rodar dentro do app.
 */
export function origemDoAltcast(empacotado: boolean): string {
  return new URL(urlDoAltcast(empacotado)).origin
}
