-- O perfil de cada pessoa, alem do nome e da foto: como no Discord, um
-- "sobre mim", os pronomes e um banner — cor solida ou imagem — no topo do
-- cartao.
--
-- Tudo NULO por padrao e sem backfill: perfil vazio e o estado de quem nunca
-- quis preencher, e inventar texto para essa pessoa seria falar por ela.
ALTER TABLE users ADD COLUMN bio text;
ALTER TABLE users ADD COLUMN pronouns text;
-- `#rrggbb`. A checagem mora aqui, e nao so na rota: a cor vai parar num
-- `style` no navegador de todo mundo, e o banco e a ultima barreira contra
-- um valor que escaparia do atributo.
ALTER TABLE users ADD COLUMN banner_color text
  CHECK (banner_color IS NULL OR banner_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE users ADD COLUMN banner_url text;
-- So para saber qual objeto apagar quando o banner for trocado. Nunca sai.
ALTER TABLE users ADD COLUMN banner_key text;
