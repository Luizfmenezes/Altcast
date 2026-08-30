import { describe, it, expect } from 'vitest'
import type { Faixa } from '../src/lib/midia.js'
import {
  ESPERA_DE_FALA_MS, MEMORIA_INICIAL, escolherPalco, guardarModo, idDaFaixa, lerModo,
} from '../src/features/voice/palco.js'

/**
 * A escolha do palco, provada como funcao.
 *
 * Vale registrar por que estes testes existem em vez de testes de componente: a
 * regra tem cinco ramos e uma histerese de dois segundos. Prova-los pela
 * interface exigiria montar a arvore, emitir eventos do SFU e adiantar
 * relogios falsos — e o que sobraria seria um teste que quebra quando o
 * `className` muda, sem dizer nada sobre a decisao que ele deveria proteger.
 */

const faixa = (userId: string, papel: Faixa['papel'], sid: string): Faixa => ({
  userId,
  papel,
  local: false,
  track: { sid } as Faixa['track'],
})

const CAMERA_ANA = faixa('ana', 'camera', 'TR_ANA')
const CAMERA_BRUNO = faixa('bruno', 'camera', 'TR_BRUNO')
const TELA_ANA = faixa('ana', 'tela', 'TR_TELA_ANA')
const TELA_BRUNO = faixa('bruno', 'tela', 'TR_TELA_BRUNO')

/** Uma escolha isolada, sem historia anterior. */
const escolher = (entrada: Partial<Parameters<typeof escolherPalco>[0]>): string | null =>
  escolherPalco({
    videos: [], falando: [], fixado: null, agora: 0, memoria: MEMORIA_INICIAL, ...entrada,
  }).palco

describe('quem sobe ao palco', () => {
  it('sem video nenhum nao ha palco, e a interface cai na grade', () => {
    expect(escolher({})).toBeNull()
  })

  it('com uma camera so, ela ocupa o palco', () => {
    expect(escolher({ videos: [CAMERA_ANA] })).toBe('TR_ANA')
  })

  it('a tela compartilhada ganha da camera', () => {
    // E o que a sala veio ver. Dividir o espaco em pe de igualdade com uma
    // webcam parada e exatamente o defeito que o palco existe para corrigir.
    expect(escolher({ videos: [CAMERA_ANA, TELA_BRUNO] })).toBe('TR_TELA_BRUNO')
  })

  it('entre duas telas, a mais recente', () => {
    expect(escolher({ videos: [TELA_ANA, TELA_BRUNO] })).toBe('TR_TELA_BRUNO')
  })

  it('a tela nao sai do palco porque outra pessoa falou', () => {
    // Quem esta mostrando algo continua no palco mesmo calado: perder a tela
    // para a webcam de quem comentou seria trocar o conteudo pelo comentario.
    const palco = escolher({
      videos: [TELA_ANA, CAMERA_BRUNO],
      falando: ['bruno'],
      agora: 10_000,
      memoria: { atual: 'TR_TELA_ANA', candidato: 'TR_BRUNO', desde: 0 },
    })
    expect(palco).toBe('TR_TELA_ANA')
  })

  it('a faixa fixada a mao ganha ate da tela compartilhada', () => {
    // Escolha manual sempre ganha da automatica: se a pessoa fixou, foi porque
    // o palpite errou, e desfazer a correcao dela seria errar duas vezes.
    const palco = escolher({ videos: [CAMERA_ANA, TELA_BRUNO], fixado: 'TR_ANA' })
    expect(palco).toBe('TR_ANA')
  })

  it('fixar alguem que saiu da sala nao prende o palco num quadro congelado', () => {
    const palco = escolher({ videos: [CAMERA_ANA], fixado: 'TR_DE_QUEM_SAIU' })
    expect(palco).toBe('TR_ANA')
  })

  it('o palco anterior some junto com a faixa dele', () => {
    // Sem isto, quem sai da chamada leva o palco junto e deixa a area
    // principal vazia com gente ainda transmitindo.
    const palco = escolher({
      videos: [CAMERA_BRUNO],
      memoria: { atual: 'TR_ANA', candidato: null, desde: 0 },
    })
    expect(palco).toBe('TR_BRUNO')
  })
})

describe('histerese da fala', () => {
  const videos = [CAMERA_ANA, CAMERA_BRUNO]

  it('uma silaba nao troca o palco', () => {
    // `ActiveSpeakersChanged` dispara a cada silaba. Trocar a cada disparo
    // produz um estroboscopio numa conversa de quatro pessoas.
    const primeira = escolherPalco({
      videos, falando: ['bruno'], fixado: null, agora: 0, memoria: MEMORIA_INICIAL,
    })
    expect(primeira.palco).toBe('TR_ANA')
  })

  it('dois segundos de fala continua tomam o palco', () => {
    const inicio = escolherPalco({
      videos, falando: ['bruno'], fixado: null, agora: 1_000, memoria: MEMORIA_INICIAL,
    })
    const depois = escolherPalco({
      videos,
      falando: ['bruno'],
      fixado: null,
      agora: 1_000 + ESPERA_DE_FALA_MS,
      memoria: inicio.memoria,
    })

    expect(inicio.palco).toBe('TR_ANA')
    expect(depois.palco).toBe('TR_BRUNO')
  })

  it('trocar de falante reinicia o cronometro', () => {
    // A espera mede fala CONTINUA de uma pessoa, e nao tempo decorrido desde a
    // primeira silaba pronunciada na sala. Sem reiniciar, duas pessoas se
    // alternando promoveriam a segunda instantaneamente.
    const bruno = escolherPalco({
      videos, falando: ['bruno'], fixado: null, agora: 0, memoria: MEMORIA_INICIAL,
    })
    const ana = escolherPalco({
      videos, falando: ['ana'], fixado: null, agora: 1_900, memoria: bruno.memoria,
    })
    const logoDepois = escolherPalco({
      videos, falando: ['ana'], fixado: null, agora: 2_100, memoria: ana.memoria,
    })

    expect(logoDepois.memoria.desde).toBe(1_900)
    expect(logoDepois.palco).toBe('TR_ANA')
  })

  it('quem ja esta no palco e fala nao produz troca nenhuma', () => {
    const memoria = { atual: 'TR_ANA', candidato: 'TR_ANA', desde: 0 }
    const palco = escolherPalco({
      videos, falando: ['ana'], fixado: null, agora: 60_000, memoria,
    })
    expect(palco.palco).toBe('TR_ANA')
  })

  it('o silencio nao devolve o palco a ninguem: quem estava, fica', () => {
    // Uma pausa para respirar nao pode desmontar a tela de quem tem a palavra.
    const palco = escolherPalco({
      videos,
      falando: [],
      fixado: null,
      agora: 10_000,
      memoria: { atual: 'TR_BRUNO', candidato: null, desde: 0 },
    })
    expect(palco.palco).toBe('TR_BRUNO')
  })
})

describe('identidade da faixa', () => {
  it('usa o sid do SFU quando ele existe', () => {
    expect(idDaFaixa(CAMERA_ANA)).toBe('TR_ANA')
  })

  it('a faixa local tem nome antes de o servidor dar um sid', () => {
    // Sem a reserva, a propria camera seria uma faixa sem nome exatamente no
    // instante em que ela aparece para o dono.
    const local: Faixa = { ...CAMERA_ANA, track: {} as Faixa['track'] }
    expect(idDaFaixa(local)).toBe('ana-camera')
  })
})

describe('modo lembrado', () => {
  it('palco e o padrao de quem nunca escolheu', () => {
    localStorage.clear()
    expect(lerModo()).toBe('palco')
  })

  it('a grade escolhida sobrevive a proxima sessao', () => {
    localStorage.clear()
    guardarModo('grade')
    expect(lerModo()).toBe('grade')
    localStorage.clear()
  })

  it('um valor estranho guardado cai no padrao em vez de quebrar a chamada', () => {
    localStorage.clear()
    localStorage.setItem('altcast:modo-da-chamada', 'holograma')
    expect(lerModo()).toBe('palco')
    localStorage.clear()
  })
})
