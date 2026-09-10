# Altcast para Windows

A casca de desktop. Ela **não contém a aplicação**: abre uma janela apontada
para a URL do Altcast e concede as capacidades que o navegador não concede.

## Por que existe

| Parede do navegador | O que o app faz |
|---|---|
| No Chrome em Windows, compartilhar uma **janela** nunca leva áudio — a caixa "compartilhar áudio" só aparece para aba e tela inteira | `audio: 'loopback'`: o som do sistema vai junto em qualquer captura |
| O seletor é o do Chrome, com abas de navegador na frente | Seletor próprio, só com telas e janelas do sistema |
| Push-to-talk morre fora da aba (`web/src/features/voice/atalhos.ts:86`) | Atalho global — fase seguinte |

Nada aqui usa injeção de DLL, driver de áudio ou hook de teclado de baixo
nível: são exatamente as três técnicas que fazem um antivírus disparar. O
overlay (fase seguinte) será uma janela transparente, o áudio por aplicativo
usará a API documentada da Microsoft, e a detecção de jogo lê a lista de
processos — o mesmo que o Gerenciador de Tarefas faz.

## Rodar em desenvolvimento

```
npm run dev -w @altcast/web        # o Vite em :5173
npm run dev -w @altcast/desktop    # a janela apontada para ele
```

`ALTCAST_URL` vence o padrão:

```
ALTCAST_URL=https://teste.exemplo npm run dev -w @altcast/desktop
```

## Gerar o instalador

```
npm run dist -w @altcast/desktop
```

Sai em `desktop/dist-instalador/`. `npm run empacotar -w @altcast/desktop`
monta a pasta sem gerar instalador — pega erro de configuração em segundos.

## Antes do primeiro instalador de verdade

1. **A URL.** `src/config.ts`, constante `URL_DE_PRODUCAO`. É compilada porque
   `ALTCAST_URL` não existe na máquina de quem instala.
2. **O ícone.** `recursos/icon.ico`, 256x256 no mínimo. Sem ele o app sai com o
   ícone do próprio Electron.
3. **O destino da atualização.** `electron-builder.yml`, bloco `publish`.
4. **A assinatura**, se houver. Veja o comentário no `electron-builder.yml`.
   Sem assinatura o instalador funciona, mas o SmartScreen avisa nas primeiras
   execuções — isso é falta de reputação, não detecção de ameaça.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/main.ts` | Janela, endurecimento, permissões de mídia, navegação |
| `src/preload.ts` | A ponte estreita exposta como `window.altcast`. **Empacotada por esbuild** — um preload em sandbox não consegue `require` de arquivo local |
| `src/captura.ts` | Seletor de fonte e o `setDisplayMediaRequestHandler` com loopback |
| `src/ponte.ts` | O contrato entre os dois processos. Espelhado em `web/src/lib/nativo.ts` |
| `src/config.ts` | De onde a interface é carregada |
