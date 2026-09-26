-- Cargos: nome, cor, hierarquia e permissoes por grupo.
--
-- Substituem os tres papeis fixos (`owner`, `admin`, `member`) como fonte das
-- PERMISSOES. Nao substituem `group_members.role`, que continua existindo e
-- continua sendo a verdade sobre quem e o dono — a invariante de um unico dono
-- por grupo vive no indice `group_one_owner_idx`, e nenhuma tabela nova
-- substitui isso.
--
-- A regra que esta migracao precisa cumprir, e que o teste de equivalencia
-- cobra: no dia em que ela rodar, NENHUMA celula de comportamento pode mudar.
-- Por isso a semente reproduz exatamente os conjuntos de antes.

CREATE TABLE roles (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        text NOT NULL,

  -- '#RRGGBB' ou NULO. Nulo nao e "sem cor escolhida ainda": e "herda a cor do
  -- texto", que e um resultado legitimo e o padrao do cargo de todos.
  color       text,
  CONSTRAINT roles_color_hex CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),

  -- A hierarquia. Maior manda mais, e isso NAO e decoracao: sem ela um
  -- moderador expulsa um administrador. A comparacao mora em can.ts.
  position    int  NOT NULL DEFAULT 0,

  -- Os literais de Action, e nao um bitfield. O bitfield do Discord existe por
  -- uma escala que nos nao temos, e cobra caro: um numero que ninguem le sem
  -- uma tabela de traducao ao lado, e uma migracao perigosa toda vez que uma
  -- permissao nasce. Texto e auditavel direto no psql.
  permissions text[] NOT NULL DEFAULT '{}',

  -- O cargo de todos (`@everyone`). E uma LINHA DE VERDADE, e nao um valor
  -- implicito: custa esta coluna e economiza um caso especial em toda consulta
  -- de resolucao, em toda tela e em todo teste.
  is_default  boolean NOT NULL DEFAULT false,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sem diferenciar maiuscula: dois cargos "Moderador" e "moderador" na mesma
-- lista sao dois cargos que ninguem distingue de relance.
CREATE UNIQUE INDEX roles_group_name_key ON roles (group_id, lower(name));

-- Exatamente um cargo padrao por grupo. Zero deixaria o grupo sem permissoes
-- de base; dois fariam a resolucao depender da ordem da consulta.
CREATE UNIQUE INDEX roles_group_default_key ON roles (group_id) WHERE is_default;

CREATE INDEX roles_group_pos_idx ON roles (group_id, position DESC);

-- Quem tem qual cargo.
CREATE TABLE member_roles (
  group_id uuid NOT NULL,
  user_id  uuid NOT NULL,
  role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id, role_id),

  -- A chave estrangeira aponta para group_members, e NAO para users.
  --
  -- E o que garante, no banco, que sair do grupo leva os cargos junto. Com uma
  -- FK para users, sair deixaria linhas orfas aqui que voltariam a valer
  -- sozinhas se a pessoa fosse readmitida depois — um moderador que se demitiu
  -- reaparecendo moderador, sem ninguem ter decidido isso.
  FOREIGN KEY (group_id, user_id)
    REFERENCES group_members(group_id, user_id) ON DELETE CASCADE
);

CREATE INDEX member_roles_role_idx ON member_roles (role_id);

-- Excecoes por canal: o que um cargo (ou uma pessoa) ganha ou perde ALI.
--
-- Nao concedem acesso a canal privado do qual a pessoa nao participa: essa
-- porta continua sendo `channel_members`, e so ela. A excecao ajusta o que a
-- pessoa pode FAZER num canal que ela ja enxerga.
CREATE TABLE channel_overwrites (
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('role', 'user')),
  subject_id   uuid NOT NULL,
  allow        text[] NOT NULL DEFAULT '{}',
  deny         text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (channel_id, subject_type, subject_id)
);

-- ---------------------------------------------------------------- a semente
--
-- Um cargo de todos e um cargo de administrador por grupo, com exatamente as
-- permissoes que `member` e `admin` tinham em can.ts. Os literais estao
-- repetidos aqui de proposito: a migracao e um retrato do que valia no dia em
-- que rodou, e nao pode mudar de sentido porque `acoes.ts` mudou depois.

INSERT INTO roles (id, group_id, name, color, position, permissions, is_default)
SELECT
  gen_random_uuid(), g.id, 'todos', NULL, 0,
  ARRAY[
    'channel.read', 'channel.write', 'message.create', 'message.attach',
    'attachment.read', 'message.react', 'channel.join_call', 'channel.publish'
  ]::text[],
  true
FROM groups g;

INSERT INTO roles (id, group_id, name, color, position, permissions, is_default)
SELECT
  gen_random_uuid(), g.id, 'Administrador', '#5865F2', 10,
  ARRAY[
    'channel.read', 'channel.write', 'message.create', 'message.attach',
    'attachment.read', 'message.react', 'channel.join_call', 'channel.publish',
    'group.update', 'group.invite', 'group.kick',
    'channel.create', 'channel.update', 'channel.delete', 'channel.manage_members',
    'channel.moderate_call', 'message.delete_any'
  ]::text[],
  false
FROM groups g;

-- Quem ja era admin recebe o cargo. O dono NAO recebe: ele atravessa toda
-- permissao concedivel pelo `ehDono` do ator, e vincula-lo aqui faria parecer
-- que tirar o cargo lhe tiraria o poder — o que seria mentira, e a pior
-- especie de mentira numa tela de permissao.
INSERT INTO member_roles (group_id, user_id, role_id)
SELECT gm.group_id, gm.user_id, r.id
FROM group_members gm
JOIN roles r ON r.group_id = gm.group_id AND r.name = 'Administrador'
WHERE gm.role = 'admin';
