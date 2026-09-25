-- Entrada pelo Google e convite dirigido a uma pessoa.
--
-- As duas mudancas atacam o mesmo ponto fraco: ate aqui, TODA porta de entrada
-- passava por uma mensagem de e-mail que precisava chegar. Confirmar endereco,
-- recuperar senha e convidar alguem de fora dependiam do mesmo canal, e quando
-- ele falha — chave ausente, dominio nao verificado, caixa de spam — nao havia
-- segundo caminho. O Google e um caminho que nao depende da nossa entrega, e o
-- convite dirigido e um que nao depende de entrega nenhuma quando a pessoa ja
-- tem conta aqui.

-- Conta nascida pelo Google nao tem senha, e inventar um hash aleatorio para
-- preencher a coluna seria guardar uma credencial que ninguem pode usar e que
-- todo codigo de leitura trataria como se fosse real. Nulo diz a verdade.
--
-- Quem entra por senha nao muda: o login ja compara contra DUMMY_HASH quando
-- nao ha hash, e o caminho para CRIAR uma senha numa conta Google e o
-- "esqueci a senha" que ja existe.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Identidade num provedor externo.
--
-- A chave e (provider, subject), e nao o e-mail: o `sub` do Google e estavel e
-- imutavel, enquanto o endereco muda. Amarrar pelo e-mail faria uma troca de
-- endereco no Google virar uma conta nova aqui.
CREATE TABLE external_identities (
  provider   text NOT NULL,
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- O endereco no momento do vinculo. Guardado para diagnostico, jamais lido
  -- como fonte de verdade: users.email e quem manda.
  email      citext NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX external_identities_user_idx ON external_identities (user_id);
-- Uma identidade por provedor por conta: duas contas Google ligadas ao mesmo
-- usuario tornariam ambigua a pergunta "com qual conta ele entra".
CREATE UNIQUE INDEX external_identities_user_provider_key
  ON external_identities (user_id, provider);

-- Convite dirigido a UMA pessoa.
--
-- Nao substitui `invites`. Sao duas coisas diferentes: `invites.code` e um
-- codigo que circula — ditado por telefone, colado no WhatsApp, aberto por
-- quem quer que o receba. Este aqui tem destinatario, e e o que faz o convite
-- existir dentro do sistema: quem ja tem conta ve o convite na propria
-- interface, sem link, sem e-mail, sem sair de onde esta.
CREATE TABLE group_invitations (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- SET NULL, e nao CASCADE: quem convidou pode sair do sistema sem levar
  -- junto o convite que a outra pessoa ainda nao respondeu.
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Exatamente um dos dois. Com conta, o convite aparece na interface dela;
  -- sem conta, fica preso ao endereco e e resgatado no cadastro.
  target_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  target_email   citext,
  role        role_enum NOT NULL DEFAULT 'member',
  expires_at  timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A invariante vive no banco, e nao so no zod: um convite sem destinatario,
  -- ou com dois, nao tem tela que saiba o que fazer com ele.
  CONSTRAINT group_invitations_um_alvo CHECK (
    (target_user_id IS NULL) <> (target_email IS NULL)
  )
);

CREATE INDEX group_invitations_group_idx ON group_invitations (group_id);
CREATE INDEX group_invitations_user_idx  ON group_invitations (target_user_id);
CREATE INDEX group_invitations_email_idx ON group_invitations (target_email);

-- Um pendente por destinatario por grupo. Parcial porque so vale enquanto
-- esta pendente: quem recusou hoje pode ser convidado de novo amanha, e quem
-- saiu do grupo tambem.
CREATE UNIQUE INDEX group_invitations_pendente_user_key
  ON group_invitations (group_id, target_user_id)
  WHERE target_user_id IS NOT NULL
    AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX group_invitations_pendente_email_key
  ON group_invitations (group_id, target_email)
  WHERE target_email IS NOT NULL
    AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
