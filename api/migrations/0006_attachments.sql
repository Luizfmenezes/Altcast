-- Anexos de mensagem (Fatia 3a).
--
-- channel_id existe apesar de ser derivavel de message_id: o anexo e criado
-- ANTES da mensagem, para que o cliente possa mostrar progresso e previa, e
-- enquanto message_id for NULL o canal e a unica ancora de autorizacao que
-- existe. Depois, ele ainda poupa um JOIN em toda leitura de arquivo.
CREATE TABLE attachments (
  id           uuid PRIMARY KEY,
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id   uuid REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  object_key   text NOT NULL,
  filename     text NOT NULL,
  content_type text NOT NULL,
  byte_size    integer NOT NULL,
  width        integer,
  height       integer,
  thumb_key    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Carregar os anexos de uma pagina de mensagens.
CREATE INDEX attachments_message_id_idx ON attachments (message_id);

-- Serve a faxina de orfaos e a soma da cota por canal. Parcial, porque a
-- faxina so olha para o que ainda nao tem mensagem: o indice inteiro seria
-- maior e responderia a mesma pergunta mais devagar.
CREATE INDEX attachments_orfaos_idx ON attachments (created_at)
  WHERE message_id IS NULL;

CREATE INDEX attachments_channel_id_idx ON attachments (channel_id);
