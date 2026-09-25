export const ERROR_CATALOG = {
  unauthenticated:     { status: 401, message: 'Voce precisa entrar para continuar.' },
  forbidden:           { status: 403, message: 'Voce nao tem permissao para isso.' },
  not_found:           { status: 404, message: 'Nao encontrado.' },
  validation_failed:   { status: 422, message: 'Confira os campos destacados.' },
  invite_not_found:    { status: 404, message: 'Convite inexistente.' },
  invite_expired:      { status: 410, message: 'Este convite expirou.' },
  invite_revoked:      { status: 410, message: 'Este convite foi revogado.' },
  invite_exhausted:    { status: 410, message: 'Este convite atingiu o limite de usos.' },
  already_member:      { status: 409, message: 'Voce ja participa deste grupo.' },
  email_taken:         { status: 409, message: 'Este e-mail ja esta cadastrado.' },
  invalid_credentials: { status: 401, message: 'E-mail ou senha incorretos.' },
  rate_limited:        { status: 429, message: 'Muitas tentativas. Aguarde um instante.' },
  owner_cannot_leave:  { status: 409, message: 'Transfira a titularidade antes de sair.' },
  channel_name_taken:  { status: 409, message: 'Ja existe um canal com esse nome.' },
  message_id_taken:    { status: 409, message: 'Esta mensagem ja foi enviada.' },
  media_unavailable:   { status: 503, message: 'A chamada esta indisponivel neste servidor.' },
  storage_unavailable: { status: 503, message: 'Os anexos estao indisponiveis neste servidor.' },
  file_too_large:      { status: 413, message: 'O arquivo passa do limite de 25 MB.' },
  quota_exceeded:      { status: 413, message: 'O canal atingiu o limite de armazenamento.' },
  too_many_attachments:{ status: 422, message: 'No maximo 10 arquivos por mensagem.' },
  attachment_in_use:   { status: 409, message: 'Este anexo ja pertence a outra mensagem.' },
  email_not_verified:  { status: 403, message: 'Confirme seu e-mail para fazer isso.' },
  // Uma mensagem so para as duas causas — token errado e token vencido — de
  // proposito: distingui-las diria a quem tentou adivinhar que chegou perto.
  reset_token_invalid: { status: 400, message: 'Este link e invalido ou ja expirou. Peca outro.' },
  verification_token_invalid: { status: 400, message: 'Este link e invalido ou ja expirou. Peca outro.' },
  wrong_password:      { status: 401, message: 'Senha atual incorreta.' },
  invitation_not_found:{ status: 404, message: 'Convite inexistente.' },
  // 410, e nao 404: aqui o convite EXISTIU e quem pergunta e o proprio
  // destinatario. Esconder isso dele nao protege ninguem, so confunde.
  invitation_closed:   { status: 410, message: 'Este convite nao esta mais aberto.' },
  already_invited:     { status: 409, message: 'Esta pessoa ja tem um convite pendente.' },
  cannot_invite_self:  { status: 422, message: 'Voce ja participa deste grupo.' },
  // Conta nascida pelo Google nao tem senha para conferir. Dizer isso e
  // seguro: quem recebe a mensagem ja provou ser o dono da sessao.
  no_password_set:     { status: 409, message: 'Esta conta entra pelo Google. Use "esqueci a senha" para criar uma senha.' },
  google_unavailable:  { status: 503, message: 'A entrada pelo Google nao esta configurada neste servidor.' },
  internal_error:      { status: 500, message: 'Algo deu errado. Tente novamente.' },
} as const

export type ErrorCode = keyof typeof ERROR_CATALOG

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, details?: unknown) {
    super(ERROR_CATALOG[code].message)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_CATALOG[code].status
    this.details = details
  }
}
