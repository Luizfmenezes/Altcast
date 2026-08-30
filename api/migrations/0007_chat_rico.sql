-- Reacoes, respostas, mencoes e nao-lidos (Fatias 3b e 3c).
--
-- A 3a — anexos — ja esta em 0006. O que falta da spec de chat rico e o que
-- transforma uma lista de mensagens numa CONVERSA: reagir sem escrever,
-- responder sem perder o fio, chamar alguem pelo nome e saber o que ficou para
-- tras.

-- Uma pessoa nao reage duas vezes com o mesmo emoji, e quem garante isso e a
-- CHAVE PRIMARIA — nao uma consulta antes da insercao, que perde a corrida
-- com dois cliques rapidos e deixa a contagem errada para sempre.
--
-- `emoji` guarda o caractere Unicode, e nao um id de catalogo: assim uma
-- atualizacao da tabela de emoji nao invalida a reacao de ninguem.
CREATE TABLE reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Carregar as reacoes de uma pagina inteira de mensagens numa consulta so.
-- A PK ja comeca por message_id, mas ela e composta por tres colunas: um
-- indice proprio responde a pergunta comum lendo menos paginas.
CREATE INDEX reactions_message_id_idx ON reactions (message_id);

-- Mencao a UMA pessoa vira linha. Mencao a todos do canal nao: um grupo de
-- 200 pessoas geraria 200 linhas por mensagem sem nenhuma informacao nova, e
-- por isso ela e a coluna `mentions_everyone` em messages.
CREATE TABLE mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

-- "O que eu ja li", por canal e por pessoa.
--
-- Guarda um MARCO, e nao uma contagem: o numero de nao-lidos e derivado de
-- "mensagens com id maior que este", e o indice (channel_id, id DESC) que ja
-- existe responde isso sem varrer nada. Guardar o numero exigiria reescrever
-- uma linha por membro a cada mensagem enviada.
CREATE TABLE channel_reads (
  channel_id           uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Ler todos os marcos de uma pessoa de uma vez, para montar o `ready`.
CREATE INDEX channel_reads_user_idx ON channel_reads (user_id);

-- SET NULL, e jamais CASCADE: apagar a mensagem citada nao pode levar junto a
-- resposta a ela. A citacao vira "mensagem apagada" e a conversa continua
-- legivel — com CASCADE, apagar uma pergunta apagaria em silencio todas as
-- respostas dela.
ALTER TABLE messages
  ADD COLUMN reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN mentions_everyone boolean NOT NULL DEFAULT false;

-- Carregar as mensagens citadas de uma pagina numa consulta so. Parcial
-- porque a maioria das mensagens nao responde a nada: o indice inteiro seria
-- maior e responderia a mesma pergunta mais devagar.
CREATE INDEX messages_reply_to_idx ON messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;
