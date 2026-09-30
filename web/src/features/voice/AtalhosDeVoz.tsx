import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import {
  atalhoDoEvento, ehModificador, FALA_PADRAO, guardarFala, lerFala, mesmoAtalho, nomeDaTecla,
  rotuloDoAtalho,
} from './atalhos.js'
import type { Atalho, ModoDeFala, PreferenciasDeFala } from './atalhos.js'

/**
 * As teclas da chamada, escolhidas pela pessoa.
 *
 * O gesto e o do Discord: clicar em "Gravar", apertar a combinacao, pronto.
 * Digitar o nome de uma tecla num campo seria pedir que a pessoa soubesse
 * como o navegador chama a tecla — `KeyM`, `Backquote` —, e ninguem sabe.
 */

type Campo = 'mudo' | 'surdo' | 'tecla'

const ROTULOS: Record<Campo, { titulo: string; nota: string }> = {
  mudo: {
    titulo: 'Mutar / desmutar microfone',
    nota: 'Liga e desliga o seu microfone na chamada.',
  },
  surdo: {
    titulo: 'Ensurdecer',
    nota: 'Para de ouvir a sala e desliga o microfone junto.',
  },
  tecla: {
    titulo: 'Apertar para falar',
    nota: 'Segure para falar quando o modo "Apertar para falar" estiver ligado.',
  },
}

/**
 * Grava a proxima combinacao apertada.
 *
 * Escuta na fase de CAPTURA da janela, antes de todo o resto: sem isso o
 * `M` apertado para gravar tambem mutaria o microfone, e o `Esc` para
 * cancelar fecharia o dialogo de configuracoes inteiro.
 */
function useGravacao(ativa: boolean, aoGravar: (a: Atalho | null) => void, aoCancelar: () => void): void {
  useEffect(() => {
    if (!ativa) return
    const aoApertar = (evento: KeyboardEvent): void => {
      evento.preventDefault()
      evento.stopImmediatePropagation()
      if (evento.code === 'Escape') { aoCancelar(); return }
      if (evento.code === 'Backspace' || evento.code === 'Delete') { aoGravar(null); return }
      // So o modificador ainda nao e atalho: espera a tecla que ele modifica.
      if (ehModificador(evento.code)) return
      aoGravar(atalhoDoEvento(evento))
    }
    window.addEventListener('keydown', aoApertar, { capture: true })
    return () => { window.removeEventListener('keydown', aoApertar, { capture: true }) }
  }, [ativa, aoGravar, aoCancelar])
}

export function AtalhosDeVoz(): ReactNode {
  const [fala, setFala] = useState<PreferenciasDeFala>(lerFala)
  const [gravando, setGravando] = useState<Campo | null>(null)

  function mudar(proximo: PreferenciasDeFala): void {
    setFala(proximo)
    guardarFala(proximo)
  }

  const gravar = (atalho: Atalho | null): void => {
    if (gravando === null) return
    if (gravando === 'tecla') {
      // Push-to-talk e uma tecla so, segurada: modificador nao faz sentido, e
      // "nenhuma" deixaria o modo ligado sem jeito de falar.
      if (atalho !== null) mudar({ ...fala, tecla: atalho.code })
    } else {
      mudar({ ...fala, [gravando]: atalho })
    }
    setGravando(null)
  }
  useGravacao(gravando !== null, gravar, () => { setGravando(null) })

  const valorDe = (campo: Campo): Atalho | null =>
    campo === 'tecla'
      ? { code: fala.tecla, ctrl: false, alt: false, shift: false, meta: false }
      : fala[campo]

  // Duas acoes na mesma tecla: a primeira da lista ganha e a segunda nunca
  // dispara. Melhor avisar agora do que deixar a pessoa descobrir numa chamada.
  const conflito = mesmoAtalho(fala.mudo, fala.surdo)
    || (fala.modo === 'apertar' && [fala.mudo, fala.surdo].some(a =>
      a !== null && !a.ctrl && !a.alt && !a.shift && !a.meta && a.code === fala.tecla))

  return (
    <div className="flex flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-[13px] font-medium text-fg">Modo do microfone</span>
        <select
          value={fala.modo}
          onChange={e => { mudar({ ...fala, modo: e.target.value as ModoDeFala }) }}
          className="h-9 rounded border border-border bg-bg-raised px-2 text-sm text-fg"
        >
          <option value="aberto">Detecção de voz (microfone aberto)</option>
          <option value="apertar">Apertar para falar ({nomeDaTecla(fala.tecla)})</option>
        </select>
      </label>

      <ul className="flex flex-col divide-y divide-border-subtle rounded border border-border-subtle">
        {(['mudo', 'surdo', 'tecla'] as const).map(campo => {
          const ativo = gravando === campo
          return (
            <li key={campo} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg">{ROTULOS[campo].titulo}</span>
                <span className="text-xs text-fg-muted">{ROTULOS[campo].nota}</span>
              </div>
              <kbd
                aria-live="polite"
                className="min-w-24 rounded border border-border bg-bg-sunken px-2 py-1 text-center
                           font-mono text-xs text-fg"
              >
                {ativo ? 'Aperte as teclas…' : rotuloDoAtalho(valorDe(campo))}
              </kbd>
              <Botao
                variante={ativo ? 'primario' : 'discreto'}
                tamanho="sm"
                aria-pressed={ativo}
                aria-label={`Gravar atalho: ${ROTULOS[campo].titulo}`}
                onClick={() => { setGravando(ativo ? null : campo) }}
              >
                <Keyboard aria-hidden="true" />
                {ativo ? 'Cancelar' : 'Gravar'}
              </Botao>
            </li>
          )
        })}
      </ul>

      {gravando !== null && (
        <p role="status" className="text-xs text-fg-muted">
          Aperte a combinação desejada. Esc cancela; Backspace remove o atalho.
        </p>
      )}
      {conflito && (
        <p role="alert" className="text-xs text-danger">
          Duas ações estão na mesma tecla. Só a primeira vai funcionar.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Botao
          variante="discreto"
          tamanho="sm"
          onClick={() => { mudar(FALA_PADRAO) }}
        >
          <RotateCcw aria-hidden="true" />
          Restaurar padrão
        </Botao>
        <span className="text-xs text-fg-muted">
          M muta, D ensurdece, Espaço para apertar e falar. Atalhos com Ctrl ou Alt
          funcionam até enquanto você digita.
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        No navegador os atalhos só funcionam com a janela do Altcast em foco.
      </p>
    </div>
  )
}
