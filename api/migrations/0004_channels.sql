CREATE TABLE channels (
  id         uuid PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       channel_type NOT NULL DEFAULT 'text',
  visibility visibility_enum NOT NULL DEFAULT 'public',
  topic      text,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);
CREATE INDEX channels_group_pos_idx ON channels (group_id, position);

CREATE TABLE channel_members (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id);
