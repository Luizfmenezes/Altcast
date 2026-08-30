/**
 * A porta de saida de e-mail.
 *
 * Interface, e nao chamada direta ao Resend, pelo mesmo motivo de `SalaDeMidia`
 * e do `armazem` do MinIO: um teste que precisasse de rede para verificar que o
 * link de recuperacao esta certo seria um teste que ninguem roda.
 */
export type Mensagem = {
  para: string
  assunto: string
  /** Sempre presente. Cliente que recusa HTML ainda precisa do link. */
  texto: string
  html: string
}

export type Correio = {
  enviar: (mensagem: Mensagem) => Promise<void>
}
