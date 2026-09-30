-- Etapa 2 do super plano: o loop de atencao.
--
-- 1. Preferencias de notificacao, por grupo ou por canal.
--
-- Duas colunas com chave estrangeira, e nao um par (scope_type, scope_id)
-- polimorfico: com FK, apagar o grupo ou o canal apaga a preferencia junto
-- (CASCADE), e o banco garante sozinho que ninguem guarda silencio para um
-- canal que nao existe. O CHECK exige exatamente um dos dois — a invariante
-- mora no banco, e nao numa consulta antes de inserir.
--
-- `level` nulo significa "herda": o canal sem nivel proprio segue o do grupo,
-- e o grupo sem nivel segue o padrao (que depende do tamanho do grupo). Um
-- silencio temporario (`muted_until`) pode existir sem nivel proprio — e o
-- "silenciar por 1 hora" de quem nao quer mudar o nivel de nada.
--
-- `smart` e o nivel "Inteligente": notifica tambem o que a triagem do Jev
-- julgar que merece atencao, alem das mencoes. Desligado por padrao.
CREATE TABLE notification_prefs (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    uuid REFERENCES groups(id) ON DELETE CASCADE,
  channel_id  uuid REFERENCES channels(id) ON DELETE CASCADE,
  level       text CHECK (level IN ('all', 'mentions', 'none', 'smart')),
  muted_until timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_um_escopo CHECK ((group_id IS NULL) <> (channel_id IS NULL))
);

CREATE UNIQUE INDEX notification_prefs_grupo_key
  ON notification_prefs (user_id, group_id) WHERE channel_id IS NULL;
CREATE UNIQUE INDEX notification_prefs_canal_key
  ON notification_prefs (user_id, channel_id) WHERE channel_id IS NOT NULL;

-- 2. Status de presenca escolhido pela pessoa.
--
-- `online` e o automatico: aparece online quando ha conexao, ausente quando o
-- cliente avisa que ficou dez minutos sem uso. `idle` escolhido fixa o
-- ausente; `dnd` corta som e notificacao; `invisible` aparece offline para os
-- outros. O ausente AUTOMATICO nao mora aqui: e um fato sobre a conexao de
-- agora, como a propria presenca, e vive em memoria.
ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'online'
    CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
  ADD COLUMN status_text text CHECK (char_length(status_text) <= 128),
  ADD COLUMN status_emoji text CHECK (char_length(status_emoji) <= 32),
  ADD COLUMN status_expires_at timestamptz;

-- 3. A contagem de nao lidas deriva do marco (D3-C), e o marco de quem nunca
-- abriu um canal e o momento em que entrou no grupo. O indice que atende
-- `channel_id = $1 AND id > $marco` ja existe (messages_channel_id_desc_idx, por
-- channel_id, id DESC); o de mencoes por pessoa, nao.
CREATE INDEX IF NOT EXISTS mentions_user_idx ON mentions (user_id, message_id);
