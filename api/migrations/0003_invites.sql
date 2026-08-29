CREATE TABLE invites (
  code       text PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  max_uses   integer,
  uses       integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_group_idx ON invites (group_id);
