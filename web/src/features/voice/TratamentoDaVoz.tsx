import type { ReactNode } from 'react'
import { modeloDaSupressao } from '../../lib/midia.js'
import type { AjusteDoTratamento, MedidaDaVoz, ModoDoPortao, Processamento } from '../../lib/midia.js'

const PORTOES: { valor: ModoDoPortao; rotulo: string }[] = [
  { valor: 'automatico', rotulo: 'Automática' },
  { valor: 'manual', rotulo: 'Manual' },
  { valor: 'desligado', rotulo: 'Desligada' },
]

/** -100 dB a 0 dB na barra, da esquerda para a direita. */
const porcentoDe = (db: number): number => Math.min(100, Math.max(0, db + 100))

/**
 * O medidor da sensibilidade de entrada, como o do Discord: a barra e o nivel
 * da voz, o traco e o limiar. Verde quando o portao esta aberto — e isso, e
 * nao o numero, que diz se a sala esta ouvindo.
 */
function MedidorDoPortao({ medida }: { medida: MedidaDaVoz }): ReactNode {
  const nivel = porcentoDe(medida.nivelDb)
  const limiar = porcentoDe(medida.limiarDb)
  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label="Nível da voz contra o limiar"
        aria-valuemin={-100}
        aria-valuemax={0}
        aria-valuenow={Math.round(medida.nivelDb)}
        aria-valuetext={`${String(Math.round(medida.nivelDb))} dB, ${medida.aberto ? 'transmitindo' : 'microfone fechado'}`}
        className="relative h-3 overflow-hidden rounded border border-border-subtle bg-bg-raised"
      >
        <div
          className={`h-full transition-[width] duration-75 ${medida.aberto ? 'bg-presence-online' : 'bg-fg-muted/40'}`}
          style={{ width: `${String(nivel)}%` }}
        />
        <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${String(limiar)}%` }} />
      </div>
      <span className="text-xs text-fg-muted">
        {medida.aberto ? 'Transmitindo' : 'Microfone fechado: abaixo do limiar'}
        {' · limiar '}{Math.round(medida.limiarDb)} dB
      </span>
    </div>
  )
}

/**
 * O que acontece com a voz DEPOIS da escolha da supressao.
 *
 * Tudo aqui vale na hora, dentro da chamada: os ajustes vao por mensagem para
 * o processador ja plugado, sem recapturar o microfone.
 */
export function TratamentoDaVoz({ tratamento, aoMudar, medida, naChamada }: {
  tratamento: Processamento
  aoMudar: (mudanca: AjusteDoTratamento) => void
  medida: MedidaDaVoz | null
  naChamada: boolean
}): ReactNode {
  const comIa = modeloDaSupressao(tratamento.supressao) !== null

  return (
    <>
      {comIa && (
        <label className="flex flex-col gap-1 border-t border-border-subtle p-3">
          <span className="flex items-center justify-between text-[13px] font-medium text-fg">
            Intensidade da limpeza
            <span className="tabular-nums text-fg-muted">{tratamento.intensidade}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={tratamento.intensidade}
            onChange={e => { aoMudar({ intensidade: Number(e.target.value) }) }}
            className="accent-accent"
          />
          <span className="text-xs text-fg-muted">
            Abaixo de 100% volta um pouco do som original. Use se a sua voz soar robótica.
          </span>
        </label>
      )}

      <fieldset className="flex flex-col gap-2 border-t border-border-subtle p-3">
        <legend className="float-left mb-1 text-[13px] font-medium text-fg">
          Sensibilidade de entrada
        </legend>
        <div className="clear-both flex flex-wrap gap-2">
          {PORTOES.map(({ valor, rotulo }) => (
            <label
              key={valor}
              className="flex cursor-pointer items-center gap-2 rounded border border-border-subtle px-2 py-1
                         text-[13px] text-fg has-[:checked]:border-accent has-[:checked]:bg-accent-subtle"
            >
              <input
                type="radio"
                name="portao"
                value={valor}
                checked={tratamento.portao === valor}
                onChange={() => { aoMudar({ portao: valor }) }}
                className="size-4 accent-accent"
              />
              {rotulo}
            </label>
          ))}
        </div>
        <span className="text-xs text-fg-muted">
          {tratamento.portao === 'automatico'
            ? 'Fecha o microfone quando você não está falando. O limiar acompanha o barulho do ambiente.'
            : tratamento.portao === 'manual'
              ? 'Fecha o microfone abaixo do limiar que você escolher.'
              : 'O microfone fica sempre aberto.'}
        </span>
        {tratamento.portao === 'manual' && (
          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-fg">
              Limiar
              <span className="tabular-nums text-fg-muted">{tratamento.limiarDb} dB</span>
            </span>
            <input
              type="range"
              min={-100}
              max={0}
              step={1}
              value={tratamento.limiarDb}
              onChange={e => { aoMudar({ limiarDb: Number(e.target.value) }) }}
              className="accent-accent"
            />
          </label>
        )}
        {naChamada && tratamento.portao !== 'desligado' && medida !== null && (
          <MedidorDoPortao medida={medida} />
        )}
      </fieldset>

      <fieldset className="flex flex-wrap gap-4 border-t border-border-subtle p-3">
        <legend className="sr-only">Mais tratamento</legend>
        <label className="flex max-w-[280px] flex-col gap-1">
          <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <input
              type="checkbox"
              checked={tratamento.nivelador}
              onChange={e => { aoMudar({ nivelador: e.target.checked }) }}
              className="size-4 accent-accent"
            />
            Nivelador de voz
          </span>
          <span className="text-xs text-fg-muted">
            Sobe quem fala baixo e segura quem grita. Age depois da supressão, então não levanta o chiado.
          </span>
        </label>
        <label className="flex max-w-[280px] flex-col gap-1">
          <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <input
              type="checkbox"
              checked={tratamento.limparRecebido}
              onChange={e => { aoMudar({ limparRecebido: e.target.checked }) }}
              className="size-4 accent-accent"
            />
            Limpar o áudio de quem chega
          </span>
          <span className="text-xs text-fg-muted">
            Tira o ruído do microfone dos outros, inclusive de quem não tem supressão.
            Usa mais processador a cada pessoa; o som de tela compartilhada fica intacto.
          </span>
        </label>
      </fieldset>
    </>
  )
}
