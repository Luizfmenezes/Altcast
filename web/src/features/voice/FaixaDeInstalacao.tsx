import type { ReactNode } from 'react'
import { Download, MonitorSpeaker } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import { nativo } from '../../lib/nativo.js'

/**
 * O convite para instalar o aplicativo.
 *
 * Ela **nao se fecha**, ao contrario da faixa de verificacao de e-mail, e a
 * diferenca e proposital: aquela cobra uma tarefa que a pessoa ja sabe que tem
 * pendente, esta anuncia uma capacidade que ela nao tem como descobrir
 * sozinha. Quem compartilha a janela de um jogo pelo navegador nao ve erro
 * nenhum — ve video subindo e silencio do outro lado — e nao ha nada na tela
 * que ligue esse silencio a uma limitacao do Chrome.
 *
 * Some sozinha nos dois casos em que seria ruido:
 *
 * - **Dentro do app.** `nativo()` responde, e recomendar a instalacao a quem
 *   ja instalou e a forma mais rapida de ensinar as pessoas a ignorar faixas.
 * - **Fora do Windows.** O instalador e um `.exe`. Oferecer download de um
 *   binario que a maquina nao executa e pior do que nao oferecer nada:
 *   promete uma solucao e entrega um arquivo inutil.
 */

/** Onde o instalador mora. O Caddy serve este caminho a partir do disco. */
export const CAMINHO_DO_INSTALADOR = '/baixar/Altcast.exe'

/**
 * A maquina executa um `.exe`?
 *
 * `userAgentData` e o caminho moderno e o unico que o Chrome nao congelou;
 * `platform` continua como reserva porque navegadores mais antigos — e o
 * Firefox — nao implementam o primeiro. Sem nenhum dos dois, a resposta e
 * "nao": errar para o lado de nao mostrar a faixa custa uma oportunidade,
 * errar para o outro custa um download que nao abre.
 */
export function ehWindows(): boolean {
  if (typeof navigator === 'undefined') return false
  const dados = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  if (typeof dados?.platform === 'string') return dados.platform === 'Windows'
  if (typeof navigator.platform === 'string') return navigator.platform.startsWith('Win')
  return /Windows/.test(navigator.userAgent)
}

export function FaixaDeInstalacao(): ReactNode {
  if (nativo() !== null) return null
  if (!ehWindows()) return null

  return (
    <div
      role="complementary"
      aria-label="Aplicativo para Windows"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b
                 border-accent/30 bg-accent/10 px-3 py-2 text-[13px]"
    >
      <MonitorSpeaker
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-4 shrink-0 text-accent"
      />

      {/*
        O texto nomeia o GANHO, e nao o produto. "Instale o app" nao responde
        por que alguem deveria; "transmita a janela com som" responde, e e
        exatamente a coisa que o navegador nao faz.
      */}
      <p className="min-w-0 flex-1 text-fg">
        <strong className="font-semibold">Transmita com o som do jogo.</strong>
        {' '}
        <span className="text-fg-muted">
          No navegador, compartilhar a janela de um programa nunca leva áudio. O
          aplicativo para Windows resolve isso, e ainda deixa a tecla de falar
          funcionando fora da janela.
        </span>
      </p>

      {/*
        Um `<a>` de verdade, com `asChild`, e nao um botao que navega por
        script: e o que preserva "salvar como", "copiar o endereco" e o clique
        do meio — e o que faz o download continuar existindo se o JavaScript
        falhar.
      */}
      <Botao asChild tamanho="sm">
        <a href={CAMINHO_DO_INSTALADOR} download>
          <Download aria-hidden="true" />
          Baixar o aplicativo
        </a>
      </Botao>
    </div>
  )
}
