import type { Faixa } from '../../lib/midia.js'

/**
 * Quem ocupa o palco.
 *
 * Esta e uma funcao PURA, e fica fora do componente de proposito. A regra tem
 * cinco ramos e guarda memoria entre chamadas por causa da histerese — testar
 * isso dentro de um componente React exigiria montar uma arvore, simular
 * eventos e esperar por efeitos para provar uma decisao que, aqui, e uma
 * chamada de funcao e uma igualdade.
 *
 * A ordem dos ramos e a regra, e cada um existe por uma razao que a interface
 * sozinha nao contaria:
 *
 * 1. A faixa fixada a mao, se ainda existir. Escolha manual sempre ganha: se a
 *    pessoa fixou, foi porque o automatico errou, e desfazer a correcao dela
 *    seria errar duas vezes.
 * 2. A tela compartilhada mais recente. E o que a sala veio ver, e — por estar
 *    ACIMA da fala — quem esta mostrando algo nao perde o palco por ficar
 *    calado enquanto outra pessoa comenta.
 * 3. Quem esta falando, com histerese.
 * 4. A primeira camera, para que o palco nunca fique vazio tendo video.
 * 5. Nada: sem video, a interface cai na grade.
 */

/**
 * A identidade de uma faixa na interface.
 *
 * O `sid` vem do SFU e e o identificador de verdade. O par `userId-papel` e a
 * reserva para a faixa LOCAL, que existe no navegador antes de o servidor
 * devolver um `sid` — sem ela, a propria camera seria uma faixa sem nome no
 * instante em que aparece.
 */
export function idDaFaixa(faixa: Faixa): string {
  return faixa.track.sid ?? `${faixa.userId}-${faixa.papel}`
}

/**
 * Quanto tempo de fala continua e preciso para tomar o palco.
 *
 * `ActiveSpeakersChanged` dispara a cada silaba. Sem esta espera, uma conversa
 * de quatro pessoas vira um estroboscopio: o palco troca a cada "aham", e ler
 * um slide fica impossivel. Dois segundos e o tempo de uma frase curta — curto
 * o bastante para o palco acompanhar quem tem a palavra, longo o bastante para
 * ignorar quem so concordou.
 */
export const ESPERA_DE_FALA_MS = 2000

/**
 * O que a escolha precisa lembrar entre uma chamada e a proxima.
 *
 * A histerese e sobre TEMPO, e uma funcao pura nao tem onde guardar tempo. Sai
 * e volta explicitamente para que a memoria seja um dado inspecionavel, e nao
 * um estado escondido dentro do modulo — o que tornaria dois testes seguidos
 * dependentes um do outro.
 */
export type MemoriaDoPalco = {
  /** Quem esta no palco agora. */
  atual: string | null
  /** O ultimo candidato por fala, e desde quando ele fala sem parar. */
  candidato: string | null
  desde: number
}

export const MEMORIA_INICIAL: MemoriaDoPalco = { atual: null, candidato: null, desde: 0 }

export type EntradaDoPalco = {
  /** So as faixas de video: camera e tela. Audio nao ocupa palco. */
  videos: Faixa[]
  /** Os `userId` que o SFU diz estarem falando agora. */
  falando: string[]
  /** A faixa fixada a mao, se houver. */
  fixado: string | null
  agora: number
  memoria: MemoriaDoPalco
}

export function escolherPalco(entrada: EntradaDoPalco): {
  palco: string | null
  memoria: MemoriaDoPalco
} {
  const { videos, falando, fixado, agora, memoria } = entrada

  // 1. Escolha manual, e so enquanto a faixa existir: manter fixada uma faixa
  // de quem ja saiu da sala deixaria o palco preso num quadro congelado.
  if (fixado !== null && videos.some(v => idDaFaixa(v) === fixado)) {
    return { palco: fixado, memoria: { ...memoria, atual: fixado } }
  }

  // 2. A tela compartilhada. `at(-1)` porque as faixas entram na ordem em que
  // o SFU as entrega: a ultima e a mais recente, e quando duas pessoas
  // compartilham, a que acabou de comecar e a que a sala quer ver.
  const tela = videos.filter(v => v.papel === 'tela').at(-1)
  if (tela !== undefined) {
    const id = idDaFaixa(tela)
    return { palco: id, memoria: { ...memoria, atual: id } }
  }

  const cameras = videos.filter(v => v.papel === 'camera')
  const falante = cameras.find(v => falando.includes(v.userId))
  const idFalante = falante === undefined ? null : idDaFaixa(falante)

  // Trocar de falante reinicia o cronometro. E o que faz a espera medir fala
  // CONTINUA de uma pessoa, e nao tempo decorrido desde a primeira silaba
  // pronunciada na sala.
  const trocou = idFalante !== memoria.candidato
  const candidato = trocou ? idFalante : memoria.candidato
  const desde = trocou ? agora : memoria.desde

  // O palco anterior so vale enquanto a faixa dele existir. Sem esta
  // verificacao, quem sai da chamada levaria o palco junto e deixaria a area
  // principal vazia com gente transmitindo.
  const anterior = memoria.atual !== null && videos.some(v => idDaFaixa(v) === memoria.atual)
    ? memoria.atual
    : null

  const promovido = idFalante !== null && agora - desde >= ESPERA_DE_FALA_MS
    ? idFalante
    : null

  // 3, 4 e 5, nesta ordem: quem ganhou a fala, senao quem ja estava, senao a
  // primeira camera, senao nada.
  const primeira = cameras[0]
  const palco = promovido
    ?? anterior
    ?? (primeira === undefined ? null : idDaFaixa(primeira))

  return { palco, memoria: { atual: palco, candidato, desde } }
}

/**
 * Palco ou grade, lembrado entre sessoes.
 *
 * E preferencia da MAQUINA, pela mesma razao que o dispositivo e a qualidade:
 * quem usa um monitor grande quer a grade, quem usa um notebook quer o palco, e
 * sincronizar isso pela conta imporia a resposta de um lugar ao outro.
 *
 * A grade tambem e a saida de emergencia do palco automatico: se a escolha
 * errar mais do que acerta para alguem, essa pessoa precisa de um caminho de
 * volta que nao dependa de nos consertarmos a regra.
 */
export type ModoDaChamada = 'palco' | 'grade'

const CHAVE_DO_MODO = 'altcast:modo-da-chamada'

export function lerModo(): ModoDaChamada {
  try {
    return localStorage.getItem(CHAVE_DO_MODO) === 'grade' ? 'grade' : 'palco'
  } catch {
    return 'palco'
  }
}

export function guardarModo(modo: ModoDaChamada): void {
  try {
    localStorage.setItem(CHAVE_DO_MODO, modo)
  } catch {
    // Nao poder lembrar a escolha nao pode impedir de faze-la agora.
  }
}
