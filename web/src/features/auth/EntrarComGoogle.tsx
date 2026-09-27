import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api.js'
import { cn } from '../../lib/utils.js'

/**
 * O botao de entrar pelo Google.
 *
 * E um link comum — `<a href>`, nao `fetch` — e isso e o desenho inteiro. O
 * fluxo vive em redirecionamentos de servidor: o navegador sai daqui, passa
 * pelo Google e volta ja com o cookie de sessao. Nao ha SDK para carregar,
 * popup para ser bloqueado, nem token para o front guardar.
 *
 * `target` nao e definido de proposito: o aplicativo de desktop encaminha
 * navegacao para fora da origem ao navegador do sistema, e o unico jeito de a
 * sessao voltar para DENTRO da janela do Electron e a navegacao acontecer na
 * propria janela.
 */
/**
 * ## Por que existe a variante
 *
 * Este componente nasceu para o rodape do formulario de entrar, e trazia isso
 * embutido: `mt-6`, uma regua "ou" de largura total e `w-full`. Enquanto ele
 * so morou ali, ninguem notou.
 *
 * Em `BoasVindas` ele foi colocado numa LINHA, ao lado do botao de reenviar
 * e-mail. O `w-full` brigou com a linha, o `mt-6` o desalinhou da altura do
 * irmao e a regua de largura total empurrou o botao contra a borda do cartao:
 * o resultado era um "ou" solto no meio do nada e um botao cortado.
 *
 * Um componente que carrega a propria margem e a propria largura nao e
 * reutilizavel — ele so funciona no lugar em que foi escrito. A variante nao e
 * uma opcao de estilo: e a correcao do defeito.
 */
export function EntrarComGoogle({ rotulo, variante = 'bloco', convite }: {
  rotulo: string
  /**
   * O convite em curso. Vai ao servidor na ida, volta no fim do fluxo, e a
   * pessoa chega ao aplicativo ja dentro do grupo — o Google era a terceira
   * porta por onde o codigo se perdia.
   */
  convite?: string | undefined
  /**
   * `bloco` e o rodape de formulario: separador "ou" acima, largura total.
   * `linha` e o botao sozinho, do tamanho do conteudo, sem margem propria —
   * para quando ele e UMA das opcoes numa fileira, e nao o fim de um caminho.
   */
  variante?: 'bloco' | 'linha'
}): ReactNode {
  const [disponivel, setDisponivel] = useState(false)

  // Perguntado ao servidor, e nao assumido: as credenciais sao opcionais no
  // ambiente, e desenhar o botao onde o operador nao configurou nada levaria a
  // pessoa a um redirecionamento que so volta com erro.
  useEffect(() => {
    let vigente = true
    api.get<{ google: boolean }>('/auth/providers')
      .then(p => { if (vigente) setDisponivel(p.google) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [])

  if (!disponivel) return null

  const botao = (
    <a
      href={convite === undefined
        ? '/api/auth/google/start'
        : `/api/auth/google/start?convite=${encodeURIComponent(convite)}`}
      className={cn(
        `inline-flex items-center justify-center gap-3 rounded-md border border-border
         bg-bg-raised text-sm font-medium text-fg transition-colors hover:bg-bg-hover
         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
         focus-visible:outline-accent`,
        variante === 'bloco' ? 'h-11 w-full' : 'h-9 px-3',
      )}
    >
      <MarcaGoogle />
      {rotulo}
    </a>
  )

  // Sem embrulho nenhum na variante de linha: quem a usa decide o espacamento,
  // e um `div` a mais aqui ja seria uma decisao de layout tomada no lugar
  // errado.
  if (variante === 'linha') return botao

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border-subtle" />
        <span className="text-xs uppercase tracking-wider text-fg-muted">ou</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
      {botao}
    </div>
  )
}

/**
 * A marca, em SVG inline e nas cores oficiais.
 *
 * Inline porque uma imagem vinda do dominio do Google faria a tela de entrada
 * depender de um pedido externo para desenhar — e, num cliente com bloqueador,
 * o botao apareceria sem o simbolo que o torna reconhecivel.
 */
function MarcaGoogle(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}
