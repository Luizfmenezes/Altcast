-- A camada de julgamento (super plano, secao 7): opt-in por grupo e registro
-- de cada decisao para calibrar os limiares com dados reais.
--
-- 1. O que cada grupo ligou. Tudo desligado por padrao: a ausencia da linha e
-- "desligado", e ninguem manda texto de conversa para fora sem o grupo pedir.
-- `limiar` guarda os ajustes do grupo (e o ponto de partida quando vazio).
CREATE TABLE group_ai_settings (
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  recurso     text NOT NULL CHECK (recurso IN
                ('triagem', 'automod', 'rerank', 'ja_respondida', 'denuncias', 'cargos', 'sugestoes')),
  ativo       boolean NOT NULL DEFAULT false,
  -- Canal privado so entra quando o grupo liga isto explicitamente.
  inclui_privados boolean NOT NULL DEFAULT false,
  limiar      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, recurso)
);

-- 2. Cada julgamento feito, com o que se fez com ele.
--
-- Guarda o HASH da entrada, e nunca o texto: o registro existe para medir
-- limiares, e um espelho das conversas num segundo lugar seria um vazamento
-- esperando para acontecer. A resposta crua (probabilidades) fica — e ela que
-- permite recalibrar sem refazer a chamada.
CREATE TABLE ia_decisoes (
  id           uuid PRIMARY KEY,
  group_id     uuid REFERENCES groups(id) ON DELETE CASCADE,
  recurso      text NOT NULL,
  versao       text NOT NULL,
  entrada_hash text NOT NULL,
  resposta     jsonb,
  latencia_ms  integer,
  acao         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ia_decisoes_grupo_idx ON ia_decisoes (group_id, recurso, created_at DESC);
