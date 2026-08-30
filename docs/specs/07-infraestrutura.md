# 07 — Infraestrutura

Este documento não estava entre as seções do design original. Foi acrescentado
porque o cliente exigiu execução em Docker e fornecerá uma VPS — e sem ele o
plano de implementação teria uma lacuna operacional.

## 1. Ambiente alvo

| Item | Definição |
|---|---|
| Servidor | VPS Linux, fornecida pelo cliente |
| Mínimo recomendado (Fatia 1) | 2 vCPU, 2 GB de RAM, 20 GB de disco |
| Mínimo recomendado (Fatia 2) | 4 vCPU, 8 GB de RAM, e banda de saída generosa |
| Orquestração | Docker Compose |
| TLS | Caddy com Let's Encrypt automático |
| Domínio | A definir; necessário antes do primeiro deploy |

O salto de requisito entre as fatias é o SFU: na Fatia 2 o vídeo de todos passa
pelo servidor. Dez participantes a 2,5 Mbps significam cerca de 25 Mbps de saída
sustentada por chamada — a franquia de tráfego da VPS deve ser verificada
**antes** de a Fatia 2 começar.

## 2. Serviços

| Serviço | Imagem | Portas | Fatia |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | 80, 443 | 1 |
| `api` | build local, `node:24-alpine` | 3000 interna | 1 |
| `web` | build local, servido pelo Caddy | — | 1 |
| `postgres` | `postgres:16-alpine` | 5432 interna | 1 |
| `livekit` | `livekit/livekit-server` | 7880, 7881, 50000-60000/udp | 2 |

Nenhuma porta de banco é publicada no host. Acesso administrativo ao Postgres se
dá por túnel SSH, nunca exposto à internet.

## 3. Variáveis de ambiente

Arquivo `.env.example` versionado; `.env` real **nunca** no repositório.

| Variável | Exemplo | Observação |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://altcast:SENHA@postgres:5432/altcast` | |
| `POSTGRES_USER` | `altcast` | |
| `POSTGRES_PASSWORD` | valor gerado | 32 bytes aleatórios |
| `POSTGRES_DB` | `altcast` | |
| `SESSION_COOKIE_NAME` | `altcast_session` | |
| `SESSION_TTL_DAYS` | `30` | |
| `ALLOWED_ORIGINS` | `https://altcast.exemplo.com.br` | Verificação de `Origin` |
| `PUBLIC_URL` | `https://altcast.exemplo.com.br` | Montagem de links de convite |
| `LOG_LEVEL` | `info` | |
| `SEED_OWNER_EMAIL` | endereço do primeiro usuário | Só no bootstrap |
| `SEED_OWNER_PASSWORD` | senha inicial | Trocar no primeiro login |
| `LIVEKIT_API_KEY` | — | Fatia 2 |
| `LIVEKIT_API_SECRET` | — | Fatia 2 |
| `LIVEKIT_URL` | `wss://media.exemplo.com.br` | Fatia 2 |

**Todas as variáveis são validadas no arranque** por um schema em `src/env.ts`.
Faltando ou inválida, o processo morre imediatamente com mensagem clara — nunca
sobe pela metade para falhar depois em produção.

### MinIO (anexos)

Armazena os bytes dos anexos e **não publica porta nenhuma**. O navegador nunca
fala com ele: todo byte entra e sai pela API, que é o único lugar onde `can()`
existe. Um anexo de canal privado servido por URL do próprio MinIO seria
legível por quem tivesse o link, membro ou não — e a spec 03 seção 9 gasta uma
seção inteira impedindo exatamente isso para o texto.

Consequência prática: não há console web alcançável de fora. Para inspecionar o
bucket, use `docker compose exec minio mc` ou publique 9001 temporariamente em
`127.0.0.1`.

Variáveis: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (obrigatórias, o compose
recusa subir sem elas), e do lado da API `STORAGE_ENDPOINT`, `STORAGE_PORT`,
`STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`,
`STORAGE_USE_SSL`. As da API são opcionais de propósito: faltando, a API sobe
inteira, o texto funciona e só o anexo devolve 503 explícito.

Volume `minio_data`. Entra no backup pelo mesmo motivo que o `pgdata`: perder
os anexos é perder conteúdo que as pessoas mandaram.

## 4. Imagens

Build em múltiplos estágios, para as duas aplicações:

- Estágio de dependências, estágio de build, estágio final enxuto
- Usuário **não-root** no estágio final
- `HEALTHCHECK` apontando para `/api/health`
- `.dockerignore` excluindo `node_modules`, `.git`, `.env` e documentação

## 5. Perfis de execução

| Arquivo | Uso |
|---|---|
| `docker-compose.yml` | Produção |
| `docker-compose.dev.yml` | Desenvolvimento: hot reload, Postgres com porta publicada, sem Caddy |

Em desenvolvimento o front roda no dev server do Vite, com proxy para a API — o
Caddy não participa.

## 6. Migrações

Rodam **no arranque do container `api`, antes de aceitar tráfego**. Um único
container executa a migração por vez; os demais aguardam via lock consultivo do
Postgres.

Só para frente. Migração já aplicada nunca é editada.

## 7. Backup

| Item | Política |
|---|---|
| Banco | `pg_dump` diário, retenção de 14 dias |
| Destino | Fora da VPS (armazenamento de objetos ou máquina separada) |
| Restauração | **Testada ao menos uma vez antes do primeiro uso real** |
| Segredos | `.env` guardado em gerenciador de senhas, fora do servidor |

Backup nunca testado não é backup.

## 8. Observabilidade

Fatia 1, deliberadamente modesta:

- `GET /api/health` verificando processo e conectividade com o banco
- Logs estruturados em JSON, coletados pelo driver do Docker, com rotação
- Métricas contadas em memória e expostas em rota autenticada: conexões WS
  ativas, eventos por segundo, latência de consulta

Sem Prometheus, sem Grafana nesta fatia. Para dez pessoas, seria cerimônia sem
retorno.

## 9. Segurança operacional

- SSH apenas por chave, senha desabilitada
- Firewall liberando somente 22, 80 e 443 na Fatia 1; a Fatia 2 acrescenta as
  portas de mídia do LiveKit
- Atualizações automáticas de segurança do sistema
- `fail2ban` no SSH
- Contêineres sem privilégio, sistema de arquivos somente leitura onde possível
- Cabeçalhos aplicados pelo Caddy: HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`, e uma Content-Security-Policy restritiva

## 10. Ordem do primeiro deploy

1. Apontar o domínio para o IP da VPS
2. Instalar Docker e Docker Compose
3. Clonar o repositório e preencher o `.env`
4. `docker compose up -d` e verificar a emissão do certificado
5. Rodar `npm run seed:owner` uma única vez
6. Entrar, trocar a senha inicial, criar o primeiro grupo
7. Gerar um convite e validar a entrada por um segundo dispositivo
8. Configurar a rotina de backup e **testar a restauração**
