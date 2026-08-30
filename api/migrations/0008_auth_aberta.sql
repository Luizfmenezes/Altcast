-- Cadastro aberto, verificacao de e-mail e recuperacao de senha.
--
-- Ate aqui a porta de entrada era a lista de convidados: sem codigo valido nao
-- havia conta, e era isso que dispensava verificar e-mail. Abrindo o cadastro,
-- a verificacao deixa de ser dispensavel — e o e-mail passa a ser o unico
-- caminho de volta para quem perdeu a senha.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- As duas tabelas guardam o SHA-256 do token, nunca o token.
--
-- `invites.code` fica em claro porque um convite existe para circular: ele vai
-- por mensagem, e quem o tem pode usa-lo. Um token de recuperacao e o
-- contrario — e uma credencial de uso unico, e um dump de banco que vazasse
-- entregaria a conta de todo mundo com um pedido em aberto.

CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_expires_idx ON password_reset_tokens (expires_at);

-- `email` guardado junto do token, e nao lido de users no resgate: e o que
-- permite confirmar uma TROCA de endereco. O endereco novo so entra em
-- users.email depois que alguem provar que o recebe.
CREATE TABLE email_verification_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      citext NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_user_idx ON email_verification_tokens (user_id);
CREATE INDEX email_verification_expires_idx ON email_verification_tokens (expires_at);

-- Quem ja tinha conta entrou por convite, que e uma prova de confianca mais
-- forte do que um clique em link. Marca-los como verificados evita punir
-- retroativamente quem chegou pela porta antiga.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
