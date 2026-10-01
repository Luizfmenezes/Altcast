-- Conversas diretas (proposta 2026-09-10, caminho A): uma conversa e um grupo
-- invisivel, com uma marca. Mensagens, anexos, reacoes, leitura, fanout e a
-- chamada passam a valer nela sem uma linha nova — e as negacoes (renomear,
-- convidar, criar canal, mexer em cargo) moram num lugar so, `context.ts`.
ALTER TABLE groups
  ADD COLUMN kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'dm'));

-- Os dois uuids, ordenados e unidos por ':'. O indice unico e o dono da regra
-- "uma conversa por par": dois cliques simultaneos ganhariam a corrida de
-- qualquer consulta antes da insercao, e nao ganham a do banco.
ALTER TABLE groups ADD COLUMN dm_key text;
CREATE UNIQUE INDEX groups_dm_key ON groups (dm_key) WHERE dm_key IS NOT NULL;
ALTER TABLE groups ADD CONSTRAINT groups_dm_key_so_em_conversa
  CHECK (dm_key IS NULL OR kind = 'dm');

-- Fechar uma conversa e tira-la da MINHA lista, e nao apaga-la para os dois.
-- A proxima mensagem que chegar devolve a conversa a lista de quem fechou.
ALTER TABLE group_members ADD COLUMN hidden_at timestamptz;
