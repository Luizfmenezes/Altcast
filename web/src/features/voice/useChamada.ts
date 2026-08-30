import { ESTADO_INICIAL } from '../../lib/midia.js'
import type {
  EstadoDaChamada, PapelSonoro, QualidadeDaTela, QualidadeDeRecepcao, TipoDeDispositivo,
} from '../../lib/midia.js'
import { useChamadaAtiva } from './chamadaAtiva.js'

export type ControleDaChamada = {
  estado: EstadoDaChamada
  entrar: () => void
  sair: () => void
  alternarMicrofone: () => void
  alternarCamera: () => void
  alternarTela: () => void
  trocarDispositivo: (tipo: TipoDeDispositivo, deviceId: string) => void
  destravarAudio: () => void
  definirVolume: (userId: string, papel: PapelSonoro, volume: number) => void
  restaurarVolumes: () => void
  definirQualidade: (qualidade: QualidadeDaTela) => void
  definirQualidadeDeRecepcao: (sid: string, nivel: QualidadeDeRecepcao) => void
  alternarSurdo: () => void
}

/**
 * A chamada DESTE canal, se for nele que a chamada esta.
 *
 * O hook perdeu o ciclo de vida e virou uma vista: quem cria e destroi a
 * chamada e `chamadaAtiva`, acima da arvore. A mudanca que isso produz na tela
 * e a que motivou a fase inteira — trocar de canal deixou de derrubar a
 * chamada, e ler outro canal deixou de custar a conversa.
 *
 * O `channelId` continua entrando porque a resposta depende dele: o painel de
 * um canal onde a chamada NAO esta precisa mostrar "Entrar na chamada", e nao
 * os controles de uma sala que acontece em outro lugar. Sem esta comparacao,
 * abrir um canal de voz vazio mostraria os botoes da chamada do vizinho.
 */
export function useChamada(channelId: string | null): ControleDaChamada {
  const aqui = useChamadaAtiva(e => e.canal !== null && e.canal === channelId)
  const chamada = useChamadaAtiva(e => e.chamada)
  const acoes = useChamadaAtiva(e => e)

  return {
    estado: aqui ? chamada : ESTADO_INICIAL,
    entrar: () => { if (channelId !== null) void acoes.entrar(channelId) },
    sair: () => { void acoes.sair() },
    alternarMicrofone: acoes.alternarMicrofone,
    alternarCamera: acoes.alternarCamera,
    alternarTela: acoes.alternarTela,
    trocarDispositivo: acoes.trocarDispositivo,
    destravarAudio: acoes.destravarAudio,
    definirVolume: acoes.definirVolume,
    restaurarVolumes: acoes.restaurarVolumes,
    definirQualidade: acoes.definirQualidade,
    definirQualidadeDeRecepcao: acoes.definirQualidadeDeRecepcao,
    alternarSurdo: acoes.alternarSurdo,
  }
}
