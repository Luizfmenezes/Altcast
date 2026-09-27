import { useEffect, useState } from 'react'

/**
 * O roteador mais fino que resolve o problema.
 *
 * Ate aqui o app nao tinha roteador nenhum: a unica leitura de URL era o codigo
 * de convite, e ela nunca escrevia de volta. Isso bastava porque toda navegacao
 * acontecia dentro da aplicacao. Recuperacao de senha e confirmacao de e-mail
 * mudam isso — os dois chegam por um link de fora, e o endereco passa a
 * carregar informacao que so existe ali.
 *
 * Nao e `react-router`. Sao seis rotas, nenhuma aninhada, nenhuma com dados
 * carregados por rota: a biblioteca traria um roteador inteiro para resolver
 * um `switch`. O que existe aqui e o que o problema pede, e cabe num arquivo.
 */
export type Rota =
  /** A raiz: o aplicativo com sessao, o login sem ela. */
  | { nome: 'app' }
  /**
   * `convite` e o codigo que a pessoa trouxe de um link e ainda nao aceitou.
   *
   * Ele viaja na URL entre as portas — convite, login, cadastro, Google — e
   * nao num estado da tela: era um estado da tela, e "Ja tenho conta" o
   * perdia. A pessoa entrava e caia no aplicativo sem o grupo que tinha ido
   * buscar.
   */
  | { nome: 'entrar'; convite?: string }
  | { nome: 'criar-conta'; convite?: string }
  | { nome: 'esqueci-a-senha' }
  | { nome: 'redefinir'; token: string }
  | { nome: 'verificar'; token: string }
  | { nome: 'convite'; codigo: string }

/** O `?convite=` da busca, quando ha um codigo plausivel. */
function conviteDaBusca(search: string): { convite?: string } {
  const bruto = new URLSearchParams(search).get('convite')
  return bruto !== null && /^[0-9A-Za-z-]+$/.test(bruto) ? { convite: bruto } : {}
}

const PADROES: Array<[RegExp, (m: RegExpExecArray, search: string) => Rota]> = [
  [/^\/$/, (_m, q) => {
    const c = conviteDaBusca(q).convite
    // `/?convite=CODIGO` e a forma antiga do link, e continua valendo.
    return c === undefined ? { nome: 'app' } : { nome: 'convite', codigo: c }
  }],
  [/^\/entrar\/?$/, (_m, q) => ({ nome: 'entrar', ...conviteDaBusca(q) })],
  [/^\/criar-conta\/?$/, (_m, q) => ({ nome: 'criar-conta', ...conviteDaBusca(q) })],
  [/^\/esqueci-a-senha\/?$/, () => ({ nome: 'esqueci-a-senha' })],
  [/^\/redefinir\/([A-Za-z0-9_-]+)\/?$/, m => ({ nome: 'redefinir', token: m[1]! })],
  [/^\/verificar\/([A-Za-z0-9_-]+)\/?$/, m => ({ nome: 'verificar', token: m[1]! })],
  [/^\/convite\/([0-9A-Za-z-]+)\/?$/, m => ({ nome: 'convite', codigo: m[1]! })],
]

export function lerRota(url: { pathname: string; search: string } = window.location): Rota {
  for (const [padrao, montar] of PADROES) {
    const achado = padrao.exec(url.pathname)
    if (achado) return montar(achado, url.search)
  }
  // `?convite=CODIGO` continua valendo: e a forma que circulou antes de
  // existir a rota com barra, e links ja compartilhados nao podem quebrar.
  const daBusca = new URLSearchParams(url.search).get('convite')
  if (daBusca !== null && daBusca !== '') return { nome: 'convite', codigo: daBusca }
  return { nome: 'entrar' }
}

function comConvite(caminho: string, convite: string | undefined): string {
  return convite === undefined ? caminho : `${caminho}?convite=${encodeURIComponent(convite)}`
}

export function caminhoDe(rota: Rota): string {
  switch (rota.nome) {
    case 'app': return '/'
    case 'entrar': return comConvite('/entrar', rota.convite)
    case 'criar-conta': return comConvite('/criar-conta', rota.convite)
    case 'esqueci-a-senha': return '/esqueci-a-senha'
    case 'redefinir': return `/redefinir/${rota.token}`
    case 'verificar': return `/verificar/${rota.token}`
    case 'convite': return `/convite/${rota.codigo}`
  }
}

/**
 * `pushState` nao dispara `popstate` — quem escuta precisa ser avisado a mao,
 * e e o que este evento faz.
 */
const EVENTO = 'altcast:rota'

/** Empilha no historico, para que o botao Voltar do navegador funcione. */
export function irPara(rota: Rota): void {
  history.pushState(null, '', caminhoDe(rota))
  window.dispatchEvent(new Event(EVENTO))
}

/**
 * Troca a rota SEM empilhar no historico.
 *
 * Usado depois de consumir um token: reescrever `/redefinir/abc123` para
 * `/entrar` impede que o Voltar leve de volta a um link ja gasto — e tira o
 * token da barra de enderecos, de onde ele vaza para o historico e para o
 * ombro de quem estiver ao lado.
 */
export function trocarPor(rota: Rota): void {
  history.replaceState(null, '', caminhoDe(rota))
  window.dispatchEvent(new Event(EVENTO))
}

/**
 * Tira o endereco da barra SEM mudar a tela.
 *
 * `trocarPor` avisa quem escuta, e a tela troca junto — era exatamente por isso
 * que "E-mail confirmado" e "Senha trocada" nunca apareciam: o sucesso chamava
 * `trocarPor({ nome: 'entrar' })`, a rota virava `entrar` no mesmo instante e o
 * login tomava o lugar da mensagem antes de alguem conseguir le-la.
 *
 * Aqui o token sai da barra (e do historico) na hora, e a tela de sucesso
 * continua de pe ate a pessoa decidir seguir. O "Continuar" dela e que chama
 * `trocarPor`, e so entao a tela muda.
 */
export function apagarDoEndereco(rota: Rota): void {
  history.replaceState(null, '', caminhoDe(rota))
}

export function usarRota(): Rota {
  const [rota, definir] = useState<Rota>(() => lerRota())

  useEffect(() => {
    const atualizar = (): void => definir(lerRota())
    window.addEventListener('popstate', atualizar)
    window.addEventListener(EVENTO, atualizar)
    return () => {
      window.removeEventListener('popstate', atualizar)
      window.removeEventListener(EVENTO, atualizar)
    }
  }, [])

  return rota
}
