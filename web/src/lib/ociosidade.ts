import { useEffect } from 'react'
import { useStore } from './store.js'

/** Dez minutos sem mexer em nada e a pessoa aparece "ausente" (Etapa 2.9). */
export const MINUTOS_ATE_AUSENTE = 10

const EVENTOS: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'focus']

/**
 * Avisa o servidor quando a pessoa some e quando volta.
 *
 * So as TRANSICOES viajam: um quadro ao ficar ausente, outro ao voltar. O
 * movimento do mouse dispara centenas de eventos por minuto, e nenhum deles
 * sai daqui — eles so empurram o relogio para frente.
 *
 * Reconectar zera o ausente no servidor (e estado de conexao, em memoria), e
 * por isso a transicao para "conectado" reenvia o estado atual.
 */
export function useOciosidade(ativo: boolean, minutos: number = MINUTOS_ATE_AUSENTE): void {
  useEffect(() => {
    if (!ativo) return
    let ausente = false
    let relogio: ReturnType<typeof setTimeout> | null = null

    const avisar = (ocioso: boolean): void => {
      useStore.getState().enviarQuadro({ t: 'presence.idle', d: { idle: ocioso } })
    }
    const armar = (): void => {
      if (relogio !== null) clearTimeout(relogio)
      relogio = setTimeout(() => {
        ausente = true
        avisar(true)
      }, minutos * 60_000)
    }
    const mexeu = (): void => {
      if (ausente) {
        ausente = false
        avisar(false)
      }
      armar()
    }

    for (const e of EVENTOS) window.addEventListener(e, mexeu, { passive: true })
    armar()

    let anterior = useStore.getState().conexao
    const cancelar = useStore.subscribe(estado => {
      if (estado.conexao === 'conectado' && anterior !== 'conectado' && ausente) avisar(true)
      anterior = estado.conexao
    })

    return () => {
      for (const e of EVENTOS) window.removeEventListener(e, mexeu)
      if (relogio !== null) clearTimeout(relogio)
      cancelar()
    }
  }, [ativo, minutos])
}
