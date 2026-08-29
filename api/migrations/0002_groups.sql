CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  icon_url   text,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      role_enum NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);
CREATE UNIQUE INDEX group_one_owner_idx ON group_members (group_id) WHERE role = 'owner';
