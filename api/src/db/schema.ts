import {
  customType, index, integer, pgEnum, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
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
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  // RESTRICT e deliberado: apagar um usuario nao pode apagar os grupos dele
  // em silencio. A titularidade precisa ser transferida antes.
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
}, t => [
  index('messages_channel_id_desc_idx').on(t.channelId, t.id.desc()),
])
