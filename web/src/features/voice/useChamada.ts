import { useCallback, useEffect, useRef, useState } from 'react'
import { criarChamada, ESTADO_INICIAL } from '../../lib/midia.js'
import type { Chamada, EstadoDaChamada, TipoDeDispositivo } from '../../lib/midia.js'
import { useStore } from '../../lib/store.js'

export type ControleDaChamada = {
  estado: EstadoDaChamada
  entrar: () => void
  sair: () => void
  alternarMicrofone: () => void
  alternarCamera: () => void
  alternarTela: () => void
  trocarDispositivo: (tipo: TipoDeDispositivo, deviceId: string) => void
}

/**
 * A chamada do canal aberto, como estado de React.
 *
 * Uma chamada por canal, e nao uma global: trocar de canal de voz precisa
 * derrubar a anterior. Duas salas abertas ao mesmo tempo mandariam o audio da
 * pessoa para um canal que ela acha que deixou.
 */
export function useChamada(channelId: string | null): ControleDaChamada {
  const [estado, setEstado] = useState<EstadoDaChamada>(ESTADO_INICIAL)
  const chamada = useRef<Chamada | null>(null)

  useEffect(() => {
    if (channelId === null) return

    const atual = criarChamada({
      channelId,
      // Lido da store a cada quadro, e nao capturado uma vez: o socket cai e
      // volta, e uma funcao capturada no primeiro render enviaria para sempre
      // pela conexao morta.
      enviar: quadro => useStore.getState().enviarQuadro(quadro),
      aoMudar: setEstado,
    })
    chamada.current = atual

    return () => {
      // Sair no desmonte cobre os dois casos que mais deixam microfone aberto:
      // trocar de canal e fechar a aba.
      void atual.sair()
      chamada.current = null
      setEstado(ESTADO_INICIAL)
    }
  }, [channelId])

  const alternar = useCallback((
    qual: 'microfone' | 'camera' | 'tela', ligado: boolean,
  ): void => {
    const c = chamada.current
    if (c === null) return
    const acao = qual === 'microfone'
      ? c.definirMicrofone
      : qual === 'camera' ? c.definirCamera : c.definirTela
    void acao(ligado)
  }, [])

  return {
    estado,
    entrar: useCallback(() => void chamada.current?.entrar(), []),
    sair: useCallback(() => void chamada.current?.sair(), []),
    trocarDispositivo: (tipo, deviceId) => {
      void chamada.current?.trocarDispositivo(tipo, deviceId)
    },
    alternarMicrofone: () => alternar('microfone', !estado.microfone),
    alternarCamera: () => alternar('camera', !estado.camera),
    alternarTela: () => alternar('tela', !estado.tela),
  }
}
