-- A camada de julgamento (TypeSafe / Jev) saiu do produto.
--
-- O nivel "Inteligente" era "mencoes, e o que a triagem julgar importante".
-- Sem triagem sobra exatamente "so mencoes" — e e para la que vai quem tinha
-- escolhido, em vez de voltar a herdar um nivel que pode ser "tudo".
UPDATE notification_prefs SET level = 'mentions' WHERE level = 'smart';

ALTER TABLE notification_prefs DROP CONSTRAINT IF EXISTS notification_prefs_level_check;
ALTER TABLE notification_prefs
  ADD CONSTRAINT notification_prefs_level_check CHECK (level IN ('all', 'mentions', 'none'));

DROP TABLE IF EXISTS ia_decisoes;
DROP TABLE IF EXISTS group_ai_settings;
