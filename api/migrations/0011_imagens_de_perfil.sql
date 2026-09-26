-- Avatar e icone deixam de ser so um endereco que alguem digita e passam a ter
-- bytes nossos por tras.
--
-- A URL continua numa coluna so, e NAO derivada na leitura: `avatar_url` e
-- lida pelo `ready`, pela lista de membros, pela previa publica de convite e
-- pela entrada do Google. Transformar uma leitura em cinco seria cinco lugares
-- para alguem esquecer no futuro. Quem sobe a imagem grava a URL final; quem
-- le nao muda em nada.
--
-- `*_key` existe para UMA pergunta: qual objeto apagar quando a imagem for
-- trocada. Nunca sai numa resposta da API.
--
-- Sem backfill: o que ja existe em `avatar_url` ou veio do Google (endereco
-- absoluto, sem objeto nosso por tras) ou foi digitado por um operador. NULO
-- diz exatamente isso.
ALTER TABLE users  ADD COLUMN avatar_key text;
ALTER TABLE groups ADD COLUMN icon_key   text;
