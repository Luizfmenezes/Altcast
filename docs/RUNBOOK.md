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

Crie o primeiro usuário. O cadastro é aberto, mas o primeiro convite precisa de
alguém para emiti-lo — e esta conta nasce já com o e-mail confirmado, porque
quem roda o comando tem acesso ao servidor:

```bash
docker compose exec \
  -e SEED_OWNER_EMAIL=voce@exemplo.com.br \
  -e SEED_OWNER_PASSWORD='uma frase longa que só você saberia' \
  api node api/dist/cli/seed-owner.js
```

O seed é idempotente por recusa: se já existir qualquer usuário, ele aborta.

## Atrás de um proxy externo (a instalação de produção)

A instância de produção **não** termina TLS. Ela divide o host com outro
sistema e fica atrás de um Nginx Proxy Manager que vive noutra máquina:

```
navegador --https--> Nginx Proxy Manager --http--> Caddy --> api
   (443)              (outra máquina)             (8081)     (interno)
               `--------- UDP 51000-51100 / TCP 17881 ---------> livekit
                   (direto, sem passar por proxy nenhum)
```

Duas consequências que explicam quase todo problema desta topologia:

1. **`PUBLIC_DOMAIN=:80`**, e não o domínio. O Caddy serve em texto claro e não
   pede certificado — o certificado é do proxy de fora. Pôr o domínio aqui faz
   o Caddy tentar emitir um segundo certificado, falhar o desafio (a 80 é do
   proxy) e ficar em laço de ACME.
2. **A mídia não passa pelo proxy.** RTP é UDP e não sobrevive a um salto HTTP.
   O navegador fala direto com o IP público do host. Se `51000-51100/udp` e
   `17881/tcp` não estiverem abertos no firewall do host **e** na lista de
   segurança da nuvem, a chamada conecta, mostra o participante e não leva som.

O que o proxy precisa ter ligado: **Websockets Support** (o `/ws` da conversa e
o `/rtc` da chamada são upgrades) e o encaminhamento de `X-Forwarded-For` (a
API confia nele via `TRUST_PROXY=true` para os limites de taxa contarem por
visitante, e não todo mundo no mesmo balde).

### Mapa de portas no host

| Porta do host | Serviço | Alcance |
|---|---|---|
| `8081/tcp` | Caddy (HTTP) | o proxy externo |
| `17881/tcp` | LiveKit, mídia por TCP (saída de emergência) | navegador, direto |
| `51000-51100/udp` | LiveKit, mídia por UDP | navegador, direto |
| — | Postgres, API, sinalização do SFU | só a rede interna do compose |

As portas do LiveKit aparecem em **dois** arquivos que precisam concordar:
`ops/livekit.yaml` (o que o SFU anuncia nos candidatos ICE) e
`docker-compose.yml` (o que é publicado no host). Mude sempre os dois juntos.

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
| 429 para todo mundo, e cedo demais | `TRUST_PROXY` desligado atrás do proxy: `req.ip` vira o endereço do Caddy e os visitantes dividem um balde só. `docker compose exec api printenv TRUST_PROXY` |
| Barra de conexão em "reconectando" | Socket caindo. `docker compose logs api` e o log do Caddy; a conversa continua funcionando por REST |
| Mensagens não chegam ao vivo, mas aparecem ao recarregar | Exatamente o cenário que a arquitetura prevê. O WebSocket está degradado; a reconexão cura sozinha |
| Postgres não sobe | Volume corrompido ou disco cheio. `docker compose logs postgres`, `df -h` |
| Chamada diz "servidor de mídia não configurado" | Falta `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` ou `LIVEKIT_URL` no `.env`. É um 503 honesto, não um defeito |
| Entra na chamada mas ninguém se ouve | Portas UDP 51000-51100 fechadas no firewall do host **ou** na lista de segurança da nuvem. A mídia cai para TCP em 17881; se essa também estiver fechada, não há caminho |
| Chamada entra e cai sozinha ~15s depois | ICE não fechou. Veja `nodeIP` no log do SFU: se for o IP **público** e o navegador estiver na mesma máquina, use `LIVEKIT_CONFIG=./ops/livekit.local.yaml` |
| Console do navegador: `404` em `/rtc/v1` | Servidor LiveKit velho para o `livekit-client` instalado. O cliente 2.x usa `/rtc/v1`; servidores anteriores só têm `/rtc` |
| Navegador dá `ERR_CONNECTION_CLOSED` em `http://localhost` | HSTS gravado no navegador de uma versão anterior do Caddyfile. Limpe em `chrome://net-internals/#hsts` (Delete domain: `localhost`) |
| `invalid token` no log do LiveKit | O segredo do `.env` não é o mesmo que o container do SFU carregou. `docker compose up -d livekit` depois de mudar o `.env` |

## Chamada de voz e vídeo

A mídia é um serviço separado: o `livekit` do compose. Ele não fala com o
Postgres nem com a API — recebe do navegador um token que a API assinou e
confere apenas a assinatura.

```bash
# O SFU está de pé e validando assinatura?
curl -s "http://localhost:7880/rtc/validate?access_token=$TOKEN"
# "success" = token aceito; "invalid token" = segredo divergente
```

Trocar por LiveKit Cloud não muda uma linha de código: basta apontar
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `LIVEKIT_URL` para o projeto na nuvem
e remover o serviço `livekit` do compose.

### Qualidade da transmissão

Quem transmite escolhe a qualidade em **Configurar dispositivos → Qualidade da
minha tela**. O padrão é **1080p60**. A escolha fica no `localStorage` do
navegador (`altcast:qualidade-da-tela`), e não na conta: a resposta certa é da
máquina e da rede dela, e o mesmo usuário num desktop de fibra e num notebook
em 4G quer respostas diferentes.

| Opção | Captura | Codificação | Subida somada |
|---|---|---|---|
| 1080p · 60 fps — Máxima | 1920×1080 @60 | 8 Mb/s | ~10 Mb/s |
| 1080p · 30 fps — Equilibrada | 1920×1080 @30 | 5 Mb/s | ~7 Mb/s |
| 720p · 30 fps — Banda leve | 1280×720 @30 | 2 Mb/s | ~3 Mb/s |

Trocar vale **na próxima partilha**, não durante a atual: recapturar faria o
navegador perguntar de novo qual janela mostrar, no meio de uma apresentação.

O catálogo está em `QUALIDADES`, em `web/src/lib/midia.ts` — no **cliente**, e
não no `ops/livekit.yaml`: quem escolhe resolução e taxa de quadros é quem
publica, e o SFU só repassa. Para acrescentar ou mudar uma opção, mexa lá; a
interface se monta a partir das chaves do objeto.

**Cada opção tem duas metades, e ter só uma não entrega nada:**

| Metade | Onde | Sem ela |
|---|---|---|
| Captura — `resolution.frameRate` | segundo argumento de `setScreenShareEnabled` | O `getDisplayMedia` do Chrome grava a 30, e nenhum ajuste posterior inventa os quadros que nunca existiram |
| Codificação — `maxFramerate` | terceiro argumento (`screenShareEncoding`) | O codificador joga metade dos quadros capturados fora |

Nenhuma das duas dá erro quando falta ou diverge: a transmissão simplesmente
sai na qualidade errada, sem rastro em log nenhum. Ao mexer, mexa nas duas —
há teste cobrindo exatamente essa coerência.

O terceiro argumento é o que faz a troca valer sem sair da chamada. Sem ele a
codificação ficaria congelada no `publishDefaults` da construção da sala.

Dois parâmetros ficam fora do seletor, iguais para todas as opções:

| Parâmetro | Valor | Efeito de mudar |
|---|---|---|
| `screenShareSimulcastLayers` | 720p a 30 fps | Camada entregue a quem está com banda apertada ou janela pequena. O padrão do SDK aqui é 360p a **3** fps |
| `degradationPreference` | `maintain-framerate` | `maintain-resolution` troca fluidez por nitidez — melhor para slide parado, pior para vídeo e jogo |

**Banda.** Os números da tabela já somam as duas camadas do simulcast. Três
pessoas em 1080p60 ao mesmo tempo são 30 Mb/s de subida. Se o link do host ou
de quem publica não comporta, mande baixar a qualidade antes de procurar
defeito no SFU — o sintoma de banda insuficiente é idêntico ao de SFU com
problema.

**CPU.** 1080p60 em VP8 por software é caro para quem publica. Se travar *na
máquina de quem transmite* (ventoinha alta, resto do sistema lento), é
encoding e não rede: `chrome://webrtc-internals` mostra em `framesEncoded` se
o gargalo está na saída. A saída aqui é escolher 1080p30 nessa máquina — foi
para isso que o seletor existe.

`videoCodec` continua no VP8 padrão. Trocar para `'vp9'` melhora visivelmente a
nitidez de texto na mesma banda, ao custo de ainda mais CPU — a 60 fps essa
troca é bem mais arriscada do que a 30, então teste com as máquinas reais do
grupo antes de fixar.

A câmera continua no padrão do SDK (30 fps). A esmagadora maioria das webcams
não captura acima disso, e pedir 60 lá gastaria banda para receber os mesmos
30 quadros duplicados.

## Conferir que o e-mail sai

A configuração de correio falha onde ninguém olha: chave errada, domínio não
verificado e remetente de outro domínio produzem os três o mesmo sintoma — a
pessoa que perdeu a senha nunca recebe nada, e nenhuma tela tem como saber.

```bash
docker compose exec api node api/dist/cli/enviar-teste.js voce@exemplo.com
```

Sem `RESEND_API_KEY` o comando avisa e não finge sucesso: nesse estado a API
escreve os e-mails no log em vez de enviá-los.

**`PUBLIC_URL` monta os links.** Se ela estiver errada, o e-mail chega com um
endereço que não leva a lugar nenhum, e o único jeito de descobrir é alguém
tentar usar o link.

## Atualizar

```bash
bash ops/backup.sh          # antes da migração, sempre
git pull
docker compose up -d --build
```

As migrações rodam sozinhas no arranque. Faça um backup antes — uma migração
não tem volta automática.
