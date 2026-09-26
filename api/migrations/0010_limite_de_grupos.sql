-- Teto de tres grupos criados por pessoa, e o administrador da plataforma sem
-- teto nenhum.
--
-- Por que existe: o cadastro e aberto desde a fatia do redesenho, e criar
-- grupo e justamente a acao de que uma conta descartavel abusaria em massa. A
-- confirmacao de e-mail ja cobre a conta descartavel; o teto cobre a conta
-- real que resolve criar duzentos grupos.
--
-- A coluna NAO se chama `role`, e isso e deliberado. Papel e uma coisa por
-- grupo, decidida em `can.ts`, e a regra de lint que proibe comparar `role`
-- fora de la existe para que ninguem confunda as duas. Isto aqui e COTA, nao
-- autorizacao — e por isso tambem nao entra em `can()`.
--
-- Coluna, e nao lista de e-mails no ambiente: a migracao 0008 criou o fluxo
-- que TROCA o endereco de uma conta. Uma allowlist chaveada por e-mail daria e
-- tiraria poder de administrador em silencio a cada troca, e quem conseguisse
-- receber um e-mail de verificacao num endereco listado escalaria privilegio.
-- O id do usuario nao muda nunca.
ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

-- A contagem do teto e "grupos cujo dono sou eu", e ela roda a cada criacao de
-- grupo. Uma chave estrangeira nao cria indice no lado que REFERENCIA: sem
-- este, cada criacao varreria a tabela inteira.
CREATE INDEX groups_owner_idx ON groups (owner_id);
