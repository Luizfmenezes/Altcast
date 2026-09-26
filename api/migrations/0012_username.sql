-- Apelido e nome de usuario sao coisas diferentes.
--
-- O primeiro e como voce quer ser chamado, pode repetir e muda quando der
-- vontade. O segundo e como o sistema te ENCONTRA, e por isso nao pode
-- repetir. Sem ele, a unica forma de convidar alguem e digitando o e-mail
-- dela — o que obriga quem convida a saber, e a fazer circular, um dado que
-- nao era para circular.
--
-- NULO por padrao, e SEM backfill. Derivar "felipe" de "felipe@empresa.com"
-- entregaria a parte local do endereco de todo mundo a todo mundo, numa
-- migracao, sem ninguem ter escolhido isso. Conta nascida pelo Google tambem
-- nunca teve chance de escolher. Nulo e um estado legitimo e permanente.
ALTER TABLE users ADD COLUMN username citext;
ALTER TABLE users ADD COLUMN username_changed_at timestamptz;

-- citext, como o e-mail: "Felipe" e "felipe" sao a mesma pessoa, e deixar a
-- diferenca passar criaria dois handles visualmente identicos disputando a
-- mesma identidade.
--
-- Indice PARCIAL: em Postgres um UNIQUE comum ja permite varios NULL, mas
-- dizer `WHERE username IS NOT NULL` documenta a intencao e mantem o indice
-- fora das linhas que (hoje, todas) nao tem handle.
CREATE UNIQUE INDEX users_username_key ON users (username) WHERE username IS NOT NULL;
