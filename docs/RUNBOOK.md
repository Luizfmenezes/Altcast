# Runbook — Altcast

Operação de uma instância. Escrito para ser lido às três da manhã, por alguém
que não escreveu o sistema.

## Subir do zero num host limpo

Pré-requisitos: Docker com Compose, e o domínio **já apontando para o IP** —
o Caddy pede o certificado na primeira subida, e ele só é emitido se o DNS já
resolver.

```bash
git clone <repo> altcast && cd altcast
cp .env.example .env
$EDITOR .env          # troque POSTGRES_PASSWORD e ajuste os domínios
docker compose up -d
```

A API aplica as migrações no arranque, antes de aceitar tráfego, e um lock
consultivo garante que instâncias subindo juntas migrem uma de cada vez.

Crie o primeiro usuário — não existe cadastro avulso, e o primeiro convite
precisa de alguém para emiti-lo:

```bash
docker compose exec \
  -e SEED_OWNER_EMAIL=voce@exemplo.com.br \
  -e SEED_OWNER_PASSWORD='uma frase longa que só você saberia' \
  api node api/dist/cli/seed-owner.js
```

O seed é idempotente por recusa: se já existir qualquer usuário, ele aborta.

## Verificar que está de pé

```bash
curl -fsS https://seu.dominio/api/health          # {"status":"ok"}
docker compose ps                                  # tudo Up (healthy)
bash test/smoke.sh                                 # o essencial, ponta a ponta
```

Métricas, com sessão válida:

```bash
curl -fsS -b "altcast_session=<id>" https://seu.dominio/api/metrics
```

Devolve conexões ativas, usuários online, latência do banco, memória e uptime.
São números agregados — nunca identidades.

## Derrubar

```bash
docker compose down            # para tudo, PRESERVA os dados
docker compose down -v         # APAGA os volumes, inclusive o banco
```

O `-v` destrói o Postgres e os certificados. Ele existe para ambiente de teste;
em produção, só depois de um backup verificado.

## Ler log

```bash
docker compose logs -f api            # o que a aplicação está fazendo
docker compose logs -f web            # Caddy: TLS, proxy, acessos
docker compose logs --since 15m api   # a janela de um incidente recente
```

O log é JSON estruturado. Toda resposta de erro carrega um `requestId`, e é por
ele que se acha a linha correspondente:

```bash
docker compose logs api | grep '<requestId>'
```

Senha, hash, cookie de sessão e código de convite são **redigidos na saída** —
se você encontrar um deles no log, isso é um defeito, não um achado útil.

## Backup

```bash
bash ops/backup.sh                                        # dump em ./backups
BACKUP_REMOTO=usuario@host:/backups bash ops/backup.sh    # e para fora da VPS
```

O expurgo apaga o que passar de 14 dias, e roda **depois** de o dump novo ser
validado — nunca existe uma janela sem backup.

Agende no host:

```cron
17 3 * * *  cd /srv/altcast && BACKUP_REMOTO=usuario@host:/backups bash ops/backup.sh
```

**Backup que mora no mesmo disco do banco protege contra engano humano, e contra
absolutamente mais nada.** Defina `BACKUP_REMOTO`.

## Restaurar

Ensaio, num banco descartável, sem tocar no que está em uso — é assim que se usa
no dia a dia:

```bash
bash ops/restore.sh backups/altcast-20260829T181523Z.sql.gz
```

Ele cria um banco temporário, restaura, confere que as oito tabelas voltaram e
que o histórico de migrações veio junto, e derruba o banco no fim.

**Faça esse ensaio uma vez por mês.** Backup nunca testado não é backup, e a
hora de descobrir que o dump está quebrado não é a hora do incidente.

Restauração de verdade, sobre produção:

```bash
docker compose stop api                              # ninguém escrevendo
bash ops/restore.sh backups/<arquivo>.sql.gz --em-producao
docker compose start api
```

## Quando o certificado não emite

Sintoma: `https://` não responde, e o log do `web` repete falha de ACME.

1. **O DNS aponta para este host?** `dig +short seu.dominio` tem de devolver o
   IP da VPS. O Caddy não consegue provar o domínio se ele resolve para outro
   lugar — é a causa em quase todos os casos.
2. **As portas 80 e 443 estão abertas?** O desafio HTTP-01 entra pela 80.
   `ss -lntp | grep -E ':80|:443'` e verifique o firewall do provedor.
3. **`PUBLIC_DOMAIN` está com o domínio certo?** Se estiver `http://localhost`,
   o Caddy serve em texto claro de propósito e nunca pede certificado.
4. **Bateu no limite da autoridade certificadora?** Cinco falhas por hora por
   domínio na Let's Encrypt. O volume `caddy_data` preserva os certificados
   entre recriações; se você o apagou algumas vezes seguidas, espere uma hora.

```bash
docker compose logs web | grep -i -E 'acme|certificate|obtain'
```

## Sintomas comuns

| Sintoma | Onde olhar |
|---|---|
| API `unhealthy` no `ps` | `docker compose logs api` — quase sempre migração falhando ou `DATABASE_URL` errada |
| Login devolve 429 | Limite de 5/min por IP. É o sistema funcionando; espere um minuto |
| Barra de conexão em "reconectando" | Socket caindo. `docker compose logs api` e o log do Caddy; a conversa continua funcionando por REST |
| Mensagens não chegam ao vivo, mas aparecem ao recarregar | Exatamente o cenário que a arquitetura prevê. O WebSocket está degradado; a reconexão cura sozinha |
| Postgres não sobe | Volume corrompido ou disco cheio. `docker compose logs postgres`, `df -h` |

## Atualizar

```bash
git pull
docker compose up -d --build
```

As migrações rodam sozinhas no arranque. Faça um backup antes — uma migração
não tem volta automática.
