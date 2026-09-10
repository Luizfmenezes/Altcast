import { contextBridge, ipcRenderer } from 'electron'
import { CANAIS } from './ponte'
import type { FonteDeTela, SomDaTela } from './ponte'

/**
 * Este arquivo e EMPACOTADO por esbuild antes de virar `dist/preload.js`, e nao
 * so compilado.
 *
 * A razao e o `sandbox: true` da janela. Um preload em sandbox roda com um
 * `require` polifilado que expoe um punhado de modulos do Electron e mais nada
 * — `require('./ponte')` ali dentro simplesmente falha, o preload morre antes
 * de chamar `exposeInMainWorld`, e o sintoma e `window.altcast` ausente sem uma
 * linha de erro na janela. Empacotar resolve mantendo `ponte.ts` como fonte
 * unica dos nomes de canal, em vez de duplica-los aqui e deixar os dois lados
 * divergirem em silencio.
 */

/**
 * A ponte, e o unico ponto de contato entre a interface e o sistema.
 *
 * Ela e deliberadamente estreita. A janela carrega HTML de um servidor, e
 * `contextIsolation` mais `sandbox` garantem que esse HTML nao alcance o Node
 * — mas nao garantem nada sobre o que NOS decidirmos expor. Cada funcao aqui e
 * uma capacidade concedida para sempre: expor `ipcRenderer` inteiro, por
 * exemplo, daria a qualquer script na pagina acesso a todos os canais do
 * processo principal.
 *
 * Por isso nao ha um `invoke` generico. Sao verbos fechados, um por
 * capacidade, com o nome do canal preso deste lado.
 */
const ponte = {
  /**
   * Existe para o renderer saber que esta no app, e nao no navegador.
   *
   * O valor nao importa; a PRESENCA importa. `web/src/lib/nativo.ts` decide
   * por ela qual dos dois caminhos seguir, e e o que mantem um unico produto
   * em vez de dois.
   */
  versao: '1' as const,

  /** As telas e janelas que existem AGORA. Nunca em cache: janela abre e fecha. */
  listarFontes: (): Promise<FonteDeTela[]> =>
    ipcRenderer.invoke(CANAIS.fontes) as Promise<FonteDeTela[]>,

  /**
   * Guarda a escolha para a captura que vem em seguida.
   *
   * Chamar isto NAO comeca a transmitir: quem transmite continua sendo o
   * `setScreenShareEnabled` do LiveKit, exatamente como no navegador. Esta
   * chamada so responde de antemao a pergunta que o seletor do Chrome faria.
   */
  escolherFonte: async (id: string, som: SomDaTela): Promise<void> => {
    await ipcRenderer.invoke(CANAIS.escolherFonte, id, som)
  },
}

export type PonteNativa = typeof ponte

contextBridge.exposeInMainWorld('altcast', ponte)
