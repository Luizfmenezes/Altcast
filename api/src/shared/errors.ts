export const ERROR_CATALOG = {
  unauthenticated:     { status: 401, message: 'Você precisa entrar para continuar.' },
  forbidden:           { status: 403, message: 'Você não tem permissão para isso.' },
  not_found:           { status: 404, message: 'Não encontrado.' },
  validation_failed:   { status: 422, message: 'Confira os campos destacados.' },
  invite_not_found:    { status: 404, message: 'Convite inexistente.' },
  invite_expired:      { status: 410, message: 'Este convite expirou.' },
  invite_revoked:      { status: 410, message: 'Este convite foi revogado.' },
  invite_exhausted:    { status: 410, message: 'Este convite atingiu o limite de usos.' },
  already_member:      { status: 409, message: 'Você já participa deste grupo.' },
  email_taken:         { status: 409, message: 'Este e-mail já está cadastrado.' },
  invalid_credentials: { status: 401, message: 'E-mail ou senha incorretos.' },
  rate_limited:        { status: 429, message: 'Muitas tentativas. Aguarde um instante.' },
  owner_cannot_leave:  { status: 409, message: 'Transfira a titularidade antes de sair.' },
  channel_name_taken:  { status: 409, message: 'Já existe um canal com esse nome.' },
  message_id_taken:    { status: 409, message: 'Esta mensagem já foi enviada.' },
  media_unavailable:   { status: 503, message: 'A chamada está indisponível neste servidor.' },
  storage_unavailable: { status: 503, message: 'Os anexos estão indisponíveis neste servidor.' },
  file_too_large:      { status: 413, message: 'O arquivo passa do limite de 25 MB.' },
  quota_exceeded:      { status: 413, message: 'O canal atingiu o limite de armazenamento.' },
  too_many_attachments:{ status: 422, message: 'No máximo 10 arquivos por mensagem.' },
  attachment_in_use:   { status: 409, message: 'Este anexo já pertence a outra mensagem.' },
  email_not_verified:  { status: 403, message: 'Confirme seu e-mail para fazer isso.' },
  // Uma mensagem so para as duas causas — token errado e token vencido — de
  // proposito: distingui-las diria a quem tentou adivinhar que chegou perto.
  reset_token_invalid: { status: 400, message: 'Este link é inválido ou já expirou. Peça outro.' },
  verification_token_invalid: { status: 400, message: 'Este link é inválido ou já expirou. Peça outro.' },
  wrong_password:      { status: 401, message: 'Senha atual incorreta.' },
  invitation_not_found:{ status: 404, message: 'Convite inexistente.' },
  // 410, e nao 404: aqui o convite EXISTIU e quem pergunta e o proprio
  // destinatario. Esconder isso dele nao protege ninguem, so confunde.
  invitation_closed:   { status: 410, message: 'Este convite não está mais aberto.' },
  already_invited:     { status: 409, message: 'Esta pessoa já tem um convite pendente.' },
  cannot_invite_self:  { status: 422, message: 'Você já participa deste grupo.' },
  // Conta nascida pelo Google nao tem senha para conferir. Dizer isso e
  // seguro: quem recebe a mensagem ja provou ser o dono da sessao.
  no_password_set:     { status: 409, message: 'Esta conta entra pelo Google. Use "esqueci a senha" para criar uma senha.' },
  google_unavailable:  { status: 503, message: 'A entrada pelo Google não está configurada neste servidor.' },
  // 409 e nao 403: o pedido esta bem formado e quem pede esta autorizado — o
  // que ha e conflito com o estado do mundo, que e o que 409 significa. Mesma
  // familia de `already_member` e `owner_cannot_leave`.
  group_limit_reached: { status: 409, message: 'Você já criou o máximo de 3 grupos.' },
  // Separado de `file_too_large`, cuja mensagem crava "25 MB" e aqui mentiria.
  image_too_large:     { status: 413, message: 'A imagem passa do limite de 8 MB.' },
  unsupported_image:   { status: 422, message: 'Envie uma imagem PNG, JPEG, GIF ou WebP.' },
  username_taken:      { status: 409, message: 'Este nome de usuário já está em uso.' },
  username_change_too_soon: { status: 409, message: 'Você só pode trocar o nome de usuário uma vez por mês.' },
  role_name_taken:     { status: 409, message: 'Já existe um cargo com esse nome.' },
  role_limit_reached:  { status: 409, message: 'Este grupo atingiu o limite de 25 cargos.' },
  // O cargo de todos e a base de permissoes do grupo: apaga-lo deixaria todo
  // mundo sem nada, e renomea-lo tiraria da tela a unica linha que explica o
  // que vale para quem nao tem cargo nenhum. As PERMISSOES dele sao editaveis,
  // e e justamente para isso que ele existe.
  default_role_locked: { status: 409, message: 'O cargo de todos não pode ser renomeado nem apagado.' },
  // Hierarquia. 409, e nao 403: quem pede TEM a permissao de gerenciar cargos
  // — o que falta e altura, e isso e conflito com o estado, nao falta de
  // autorizacao. Dizer "sem permissao" mandaria a pessoa procurar no lugar
  // errado.
  role_above_you:      { status: 409, message: 'Este cargo está acima do seu. Você só mexe no que está abaixo.' },
  member_above_you:    { status: 409, message: 'Esta pessoa está acima de você na hierarquia.' },
  // A trava que impede escalar privilegio por cargo: ninguem concede o que
  // nao tem. Sem ela, quem pudesse gerenciar cargos se daria qualquer coisa.
  cannot_grant_unheld: { status: 409, message: 'Você não pode conceder uma permissão que você mesmo não tem.' },
  // Conversa direta nao se deixa: fecha-se, e a proxima mensagem a reabre.
  dm_cannot_leave:     { status: 409, message: 'Conversas se fecham, não se deixam.' },
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
