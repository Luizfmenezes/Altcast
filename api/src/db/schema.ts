import {
  boolean, customType, index, integer, pgEnum, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/** citext nao existe no drizzle-orm. E o que faz o e-mail ser unico sem
 *  diferenciar maiuscula de minuscula, direto no banco. */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
})

/** inet tambem nao existe no drizzle-orm. */
const inet = customType<{ data: string }>({
  dataType: () => 'inet',
})

export const roleEnum = pgEnum('role_enum', ['owner', 'admin', 'member'])
export const channelTypeEnum = pgEnum('channel_type', ['text', 'voice'])
export const visibilityEnum = pgEnum('visibility_enum', ['public', 'private'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull().unique(),
  /**
   * Nulo em conta que nasceu por provedor externo. Inventar um hash para
   * preencher a coluna guardaria uma credencial que ninguem pode usar e que
   * todo codigo de leitura trataria como se fosse real; nulo diz a verdade, e
   * quem quiser definir uma senha depois passa pelo "esqueci a senha" que ja
   * existe — ele emite o token e o reset grava o hash, sem caminho novo.
   */
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  /**
   * O handle unico. Nulo e estado legitimo e permanente: conta antiga nunca
   * escolheu um, e conta nascida pelo Google nunca teve a chance.
   */
  username: citext('username'),
  usernameChangedAt: timestamp('username_changed_at', { withTimezone: true }),
  avatarUrl: text('avatar_url'),
  /** So para saber qual objeto apagar quando a foto for trocada. Nunca sai. */
  avatarKey: text('avatar_key'),
  /**
   * Nulo enquanto ninguem provou receber o endereco. Nao impede entrar — so
   * fecha o que abusaria de conta descartavel: criar grupo e emitir convite.
   */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  /**
   * Administrador da PLATAFORMA — nao de um grupo. Serve a uma coisa so: nao
   * ter teto de criacao de grupos.
   *
   * Nao se chama `role` de proposito: papel e por grupo e mora em `can.ts`,
   * e confundir os dois e exatamente o que a regra de lint impede. Cota nao e
   * permissao.
   */
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // Parcial: em Postgres o UNIQUE comum ja tolera varios NULL, mas dizer isto
  // documenta que ausencia de handle nao e um handle vazio.
  uniqueIndex('users_username_key').on(t.username).where(sql`username IS NOT NULL`),
])

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  userAgent: text('user_agent'),
  ip: inet('ip'),
}, t => [
  index('sessions_user_idx').on(t.userId),
  index('sessions_expires_idx').on(t.expiresAt),
])

/**
 * Recuperacao de senha e confirmacao de endereco.
 *
 * As duas guardam o SHA-256 do token, jamais o token. `invites.code` fica em
 * claro porque um convite existe para circular; estes sao credenciais de uso
 * unico, e um dump vazado entregaria toda conta com pedido em aberto.
 */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('password_reset_user_idx').on(t.userId),
  index('password_reset_expires_idx').on(t.expiresAt),
])

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /**
   * O endereco viaja com o token, e nao e lido de `users` no resgate: e o que
   * permite confirmar uma TROCA. O endereco novo so entra em `users.email`
   * depois que alguem provar que o recebe.
   */
  email: citext('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('email_verification_user_idx').on(t.userId),
  index('email_verification_expires_idx').on(t.expiresAt),
])

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  /** Idem `users.avatar_key`. */
  iconKey: text('icon_key'),
  // RESTRICT e deliberado: apagar um usuario nao pode apagar os grupos dele
  // em silencio. A titularidade precisa ser transferida antes.
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // A contagem do teto de grupos passa por aqui a cada criacao.
  index('groups_owner_idx').on(t.ownerId),
])

export const groupMembers = pgTable('group_members', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index('group_members_user_idx').on(t.userId),
  // A invariante de um unico owner por grupo vive aqui, no banco.
  uniqueIndex('group_one_owner_idx').on(t.groupId).where(sql`role = 'owner'`),
])

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('invites_group_idx').on(t.groupId),
])

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // 'voice' existe desde a primeira migracao para nao virar retrabalho na
  // Fatia 2. Nenhum codigo de voz e escrito na Fatia 1.
  type: channelTypeEnum('type').notNull().default('text'),
  visibility: visibilityEnum('visibility').notNull().default('public'),
  topic: text('topic'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('channels_group_name_key').on(t.groupId, t.name),
  index('channels_group_pos_idx').on(t.groupId, t.position),
])

/** Populada apenas para canais 'private'. Canal publico tira acesso do grupo. */
export const channelMembers = pgTable('channel_members', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('channel_members_user_idx').on(t.userId),
])

export const messages = pgTable('messages', {
  // UUIDv7: ordenar por id e ordenar por tempo. E o que sustenta a paginacao
  // por cursor sem OFFSET.
  id: uuid('id').primaryKey(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /**
   * A mensagem citada. `set null`, e jamais `cascade`: apagar a mensagem
   * citada nao pode levar junto a resposta a ela. Com `cascade`, apagar uma
   * pergunta apagaria em silencio todas as respostas — a citacao vira
   * "mensagem apagada" e a conversa continua legivel.
   */
  replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, {
    onDelete: 'set null',
  }),
  /**
   * Mencao a todos do canal. E uma COLUNA, e nao uma linha por pessoa em
   * `mentions`: um grupo de 200 pessoas geraria 200 linhas por mensagem sem
   * nenhuma informacao nova.
   */
  mentionsEveryone: boolean('mentions_everyone').notNull().default(false),
}, t => [
  index('messages_channel_id_desc_idx').on(t.channelId, t.id.desc()),
])

/**
 * Reagir sem escrever.
 *
 * A PK tripla e a regra "uma pessoa nao reage duas vezes com o mesmo emoji",
 * garantida pelo BANCO. Uma consulta antes da insercao perderia a corrida com
 * dois cliques rapidos e deixaria a contagem errada para sempre.
 */
export const reactions = pgTable('reactions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** O caractere Unicode, nao um id de catalogo: assim ele nunca expira. */
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
  index('reactions_message_id_idx').on(t.messageId),
])

/** Mencao a UMA pessoa. A mencao a todos e `messages.mentionsEveryone`. */
export const mentions = pgTable('mentions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, t => [
  primaryKey({ columns: [t.messageId, t.userId] }),
])

/**
 * Ate onde cada pessoa leu cada canal.
 *
 * Guarda um MARCO, e nao uma contagem. O numero de nao-lidos e derivado de
 * "mensagens com id maior que este" — e como o id e UUIDv7, isso e uma
 * comparacao que o indice (channel_id, id DESC) ja atende. Guardar o numero
 * exigiria reescrever uma linha por membro a cada mensagem enviada.
 */
export const channelReads = pgTable('channel_reads', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadMessageId: uuid('last_read_message_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('channel_reads_user_idx').on(t.userId),
])

/**
 * Anexos de mensagem.
 *
 * `channelId` parece derivavel de `messageId` e nao e: o anexo nasce ANTES da
 * mensagem — e o que permite progresso de upload e previa antes de enviar — e
 * enquanto `messageId` for nulo o canal e a unica ancora de autorizacao que
 * existe. Depois, ele ainda poupa um JOIN em toda leitura de arquivo.
 */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  /** Caminho no armazenamento. Derivado do id, nunca do nome enviado. */
  objectKey: text('object_key').notNull(),
  /** O nome original. Serve para exibir e para baixar, jamais como caminho. */
  filename: text('filename').notNull(),
  /** O tipo DETECTADO no servidor, nao o que o cliente declarou. */
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  thumbKey: text('thumb_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('attachments_message_id_idx').on(t.messageId),
  index('attachments_channel_id_idx').on(t.channelId),
])

/**
 * Identidade num provedor externo.
 *
 * A chave e (provider, subject), e nao o e-mail: o `sub` do Google e estavel e
 * imutavel, enquanto o endereco muda. Amarrar pelo e-mail faria uma troca de
 * endereco la virar uma conta nova aqui.
 */
export const externalIdentities = pgTable('external_identities', {
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** O endereco no momento do vinculo. Diagnostico, nunca fonte de verdade. */
  email: citext('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.provider, t.subject] }),
  index('external_identities_user_idx').on(t.userId),
  uniqueIndex('external_identities_user_provider_key').on(t.userId, t.provider),
])

/**
 * Convite dirigido a UMA pessoa.
 *
 * Nao substitui `invites`. Sao duas coisas diferentes: `invites.code` e um
 * codigo que circula, e quem o receber pode usa-lo. Este tem destinatario, e e
 * o que faz o convite existir dentro do sistema — quem ja tem conta ve o
 * convite na propria interface, sem link e sem depender de e-mail chegar.
 *
 * `targetUserId` XOR `targetEmail`, garantido por CHECK no banco: um convite
 * sem destinatario, ou com dois, nao tem tela que saiba o que fazer com ele.
 */
export const groupInvitations = pgTable('group_invitations', {
  id: uuid('id').primaryKey(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  targetEmail: citext('target_email'),
  role: roleEnum('role').notNull().default('member'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  declinedAt: timestamp('declined_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('group_invitations_group_idx').on(t.groupId),
  index('group_invitations_user_idx').on(t.targetUserId),
  index('group_invitations_email_idx').on(t.targetEmail),
])

/**
 * Cargo dentro de um grupo: nome, cor, hierarquia e permissoes.
 *
 * Substitui `group_members.role` como fonte das PERMISSOES, e nao como fonte
 * de quem e o dono — essa continua sendo a coluna, com o indice unico parcial
 * que garante um dono por grupo.
 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** '#RRGGBB' ou nulo — e nulo significa "herda a cor do texto", que e um
   *  resultado escolhido, e nao a ausencia de uma escolha. */
  color: text('color'),
  /** Maior manda mais. Sustenta a regra "so mexo em quem esta abaixo de mim". */
  position: integer('position').notNull().default(0),
  /** Os literais de `Action`. Texto, e nao bitfield: auditavel no psql, e uma
   *  permissao nova nao cobra migracao perigosa. */
  permissions: text('permissions').array().notNull().default(sql`'{}'`),
  /** O cargo de todos. Linha de verdade, e nao valor implicito. */
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('roles_group_pos_idx').on(t.groupId, t.position.desc()),
])

/**
 * Quem tem qual cargo.
 *
 * A chave estrangeira composta aponta para `group_members`, jamais para
 * `users`: e o que faz sair do grupo levar os cargos junto, no banco. Com uma
 * FK para users, readmitir alguem devolveria em silencio a moderacao que ela
 * tinha antes de sair.
 */
export const memberRoles = pgTable('member_roles', {
  groupId: uuid('group_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId, t.roleId] }),
  index('member_roles_role_idx').on(t.roleId),
])

/**
 * A excecao de um canal: o que um cargo, ou uma pessoa, ganha ou perde ALI.
 *
 * Nunca concede acesso a canal privado do qual a pessoa nao participa — essa
 * porta continua sendo `channel_members`, e so ela. A excecao ajusta o que se
 * pode FAZER num canal que ja se enxerga.
 */
export const channelOverwrites = pgTable('channel_overwrites', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  allow: text('allow').array().notNull().default(sql`'{}'`),
  deny: text('deny').array().notNull().default(sql`'{}'`),
}, t => [
  primaryKey({ columns: [t.channelId, t.subjectType, t.subjectId] }),
])
